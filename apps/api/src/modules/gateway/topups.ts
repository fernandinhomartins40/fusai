import type { PrismaClient } from '@fusai/db';
import { safeReturnUrl } from '@fusai/shared';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { SettingsStore } from '../../lib/settings';
import type { PaymentProvider } from '../../payments/types';
import { PaymentProviderError } from '../../payments/types';
import { createOrgTopup, MAX_TOPUP_CENTS, minTopupCents } from '../payments/service';
import { type GatewayContext, requireScope, requireSecretKey } from './auth';
import { serializeCheckout } from './end-users';
import { GatewayError } from './errors';

type Options = {
  prisma: PrismaClient;
  provider: PaymentProvider;
  settings: SettingsStore;
  appUrl: string;
};

const topupBody = z
  .object({
    amountCents: z.coerce.number().int().positive().max(MAX_TOPUP_CENTS).optional(),
    packageId: z.string().min(1).max(64).optional(),
    returnUrl: z.string().max(500).optional(),
  })
  .refine((v) => (v.amountCents != null) !== !!v.packageId, {
    message: 'Informe amountCents ou packageId (só um)',
  });
const topupParams = z.object({ topupId: z.string().min(1).max(64) });

/**
 * Credits for the ORGANIZATION from inside the customer's own app ("uso próprio", D-124):
 * secret key only (it is the organization's money), scope `checkout`. Same Pix flow as the
 * dashboard top-up; also payable on the hosted page `hostedUrl`.
 */
export const topupRoutes: FastifyPluginAsync<Options> = async (app, opts) => {
  const { prisma, provider, settings } = opts;
  const ctxOf = (req: { gateway?: GatewayContext }) => {
    const ctx = req.gateway as GatewayContext;
    requireSecretKey(ctx);
    requireScope(ctx, 'checkout');
    if (ctx.appUser) {
      throw new GatewayError(
        400,
        'topup_is_for_organization',
        'Recarga é da organização: não envie X-Fuse-User. Usuários finais compram com /v1/checkout/pix.',
      );
    }
    return ctx;
  };

  app.get('/topup-options', async (req) => {
    const ctx = ctxOf(req);
    const [s, packages] = await Promise.all([
      settings.get(),
      prisma.creditPackage.findMany({
        where: { projectId: null, active: true },
        orderBy: [{ sortOrder: 'asc' }, { priceCents: 'asc' }],
      }),
    ]);
    return {
      object: 'topup_options',
      available: ctx.org.billingType !== 'INTERNAL' && !!ctx.org.document,
      hasDocument: !!ctx.org.document,
      minAmountCents: minTopupCents(s),
      maxAmountCents: MAX_TOPUP_CENTS,
      feePct: s.topup_fee_pct,
      packages: packages.map((p) => ({
        id: p.id,
        name: p.name,
        priceCents: p.priceCents,
        creditMicros: p.creditMicros.toString(),
        bonusMicros: p.bonusMicros.toString(),
        highlight: p.highlight,
      })),
    };
  });

  app.post('/topups', { schema: { body: topupBody } }, async (req, reply) => {
    const ctx = ctxOf(req);
    const body = req.body as z.infer<typeof topupBody>;
    let returnUrl: string | undefined;
    if (body.returnUrl) {
      returnUrl = safeReturnUrl(body.returnUrl) ?? undefined;
      if (!returnUrl)
        throw new GatewayError(
          400,
          'invalid_return_url',
          'returnUrl deve ser uma URL http(s) ou um deep link do app.',
        );
    }
    const idem = req.headers['idempotency-key'];
    try {
      const payment = await createOrgTopup(prisma, provider, await settings.get(), ctx.org.id, {
        ...(body.packageId ? { packageId: body.packageId } : { amountCents: body.amountCents }),
        returnUrl,
        idempotencyKey: typeof idem === 'string' && idem.length <= 100 ? idem : undefined,
      });
      return reply
        .status(201)
        .send({ ...serializeCheckout(payment, opts.appUrl), object: 'topup' });
    } catch (err) {
      if (err instanceof PaymentProviderError)
        throw new GatewayError(502, 'payment_provider_error', err.message, 'api_error');
      throw err;
    }
  });

  app.get('/topups', async (req) => {
    const ctx = ctxOf(req);
    const payments = await prisma.payment.findMany({
      where: { orgId: ctx.org.id, appUserId: null, publicId: { not: null } },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    return {
      object: 'list',
      data: payments.map((p) => {
        const { qrBase64: _qr, copyPaste: _cp, ...rest } = serializeCheckout(p, opts.appUrl);
        return { ...rest, object: 'topup' };
      }),
    };
  });

  app.get('/topups/:topupId', { schema: { params: topupParams } }, async (req) => {
    const ctx = ctxOf(req);
    const { topupId } = req.params as z.infer<typeof topupParams>;
    const payment = await prisma.payment.findUnique({ where: { publicId: topupId } });
    if (!payment || payment.orgId !== ctx.org.id || payment.appUserId)
      throw new GatewayError(404, 'topup_not_found', 'Recarga não encontrada.');
    return { ...serializeCheckout(payment, opts.appUrl), object: 'topup' };
  });
};
