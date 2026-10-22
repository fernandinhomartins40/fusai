import type { Payment, PrismaClient } from '@fusai/db';
import { safeReturnUrl } from '@fusai/shared';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { PaymentProvider } from '../../payments/types';
import {
  issueSessionToken,
  SESSION_SCOPES,
  serializeAppUser,
  upsertAppUser,
} from '../app-users/service';
import { createAppUserCheckout, type PaymentMeta } from '../payments/service';
import { type GatewayContext, requireScope, requireSecretKey } from './auth';
import { GatewayError } from './errors';

type Options = {
  prisma: PrismaClient;
  provider: PaymentProvider;
  sessionSecret: string;
  appUrl: string;
};

const externalIdSchema = z.string().trim().min(1).max(128);
const appUserBody = z.object({
  externalId: externalIdSchema,
  email: z.email().max(254).optional(),
  name: z.string().trim().min(1).max(120).optional(),
  document: z.string().trim().max(20).optional(),
});
const externalIdParams = z.object({ externalId: externalIdSchema });
const checkoutBody = z.object({
  externalId: externalIdSchema.optional(),
  packageId: z.string().min(1).max(64),
  returnUrl: z.string().max(2048).optional(),
  name: z.string().trim().min(1).max(120).optional(),
  document: z.string().trim().max(20).optional(),
  email: z.email().max(254).optional(),
});
const checkoutParams = z.object({ checkoutId: z.string().min(1).max(64) });

/** Checkout as seen by the customer's backend / app (PRD §9.3). */
export function serializeCheckout(p: Payment, appUrl: string) {
  const meta = (p.metadata ?? {}) as Partial<PaymentMeta>;
  const pending = p.status === 'PENDING';
  return {
    object: 'checkout',
    checkoutId: p.publicId,
    status: p.status,
    amountCents: p.amountCents,
    creditMicros: p.creditMicros.toString(),
    packageId: p.packageId,
    packageName: meta.packageName ?? null,
    copyPaste: pending ? p.pixCopyPaste : null,
    qrBase64: pending ? p.pixQrBase64 : null,
    expiresAt: p.expiresAt?.toISOString() ?? null,
    paidAt: p.paidAt?.toISOString() ?? null,
    hostedUrl: `${appUrl}/pay/${p.publicId}`,
    createdAt: p.createdAt.toISOString(),
  };
}

/** End users, session tokens, packages and Pix checkout under /v1 (PRD §9.3). */
export const endUserRoutes: FastifyPluginAsync<Options> = async (app, opts) => {
  const { prisma, provider } = opts;
  const ctxOf = (req: { gateway?: GatewayContext }) => req.gateway as GatewayContext;

  const findAppUser = async (projectId: string, externalId: string) => {
    const user = await prisma.appUser.findUnique({
      where: { projectId_externalId: { projectId, externalId } },
      include: { wallet: true },
    });
    if (!user) {
      throw new GatewayError(
        404,
        'app_user_not_found',
        `Usuário final "${externalId}" não encontrado. Crie com POST /v1/app-users.`,
      );
    }
    return user;
  };

  app.post('/app-users', { schema: { body: appUserBody } }, async (req, reply) => {
    const ctx = ctxOf(req);
    requireSecretKey(ctx);
    requireScope(ctx, 'app_users');
    const body = req.body as z.infer<typeof appUserBody>;
    const { user, wallet, created, freeCredit } = await upsertAppUser(prisma, ctx.project, body);
    return reply
      .status(created ? 201 : 200)
      .send({ ...serializeAppUser(user, wallet), ...(freeCredit ? { freeCredit } : {}) });
  });

  app.get('/app-users/:externalId', { schema: { params: externalIdParams } }, async (req) => {
    const ctx = ctxOf(req);
    requireSecretKey(ctx);
    requireScope(ctx, 'app_users');
    const { externalId } = req.params as z.infer<typeof externalIdParams>;
    const user = await findAppUser(ctx.project.id, externalId);
    return serializeAppUser(user, user.wallet);
  });

  app.post(
    '/app-users/:externalId/session-token',
    { schema: { params: externalIdParams } },
    async (req) => {
      const ctx = ctxOf(req);
      requireSecretKey(ctx);
      requireScope(ctx, 'app_users');
      const { externalId } = req.params as z.infer<typeof externalIdParams>;
      const user = await findAppUser(ctx.project.id, externalId);
      const { token, expiresAt } = issueSessionToken(
        user.id,
        ctx.project.id,
        opts.sessionSecret,
        Date.now(),
        ctx.key?.id,
      );
      return {
        object: 'session_token',
        token,
        expiresAt: expiresAt.toISOString(),
        scopes: [...SESSION_SCOPES],
      };
    },
  );

  app.get('/packages', async (req) => {
    const ctx = ctxOf(req);
    requireScope(ctx, 'checkout');
    const packages = await prisma.creditPackage.findMany({
      where: { projectId: ctx.project.id, active: true },
      orderBy: [{ sortOrder: 'asc' }, { priceCents: 'asc' }],
    });
    return {
      object: 'list',
      data: packages.map((p) => ({
        id: p.id,
        name: p.name,
        priceCents: p.priceCents,
        creditMicros: p.creditMicros.toString(),
        bonusMicros: p.bonusMicros.toString(),
        highlight: p.highlight,
      })),
    };
  });

  app.post('/checkout/pix', { schema: { body: checkoutBody } }, async (req, reply) => {
    const ctx = ctxOf(req);
    requireScope(ctx, 'checkout');
    const body = req.body as z.infer<typeof checkoutBody>;
    if (ctx.project.billingMode === 'ORG_WALLET') {
      throw new GatewayError(
        400,
        'billing_mode_org_wallet',
        'Este projeto cobra tudo da organização (ORG_WALLET): usuários finais não compram créditos. Mude o modo de cobrança em Configurações.',
      );
    }
    let appUser = ctx.appUser;
    if (ctx.kind === 'secret') {
      if (!body.externalId) {
        throw new GatewayError(400, 'external_id_required', 'Informe externalId do usuário final.');
      }
      appUser = await findAppUser(ctx.project.id, body.externalId);
    }
    if (!appUser) throw new GatewayError(400, 'app_user_required', 'Usuário final não informado.');
    let returnUrl: string | undefined;
    if (body.returnUrl) {
      returnUrl = safeReturnUrl(body.returnUrl) ?? undefined;
      if (!returnUrl) {
        throw new GatewayError(
          400,
          'invalid_return_url',
          'returnUrl deve ser uma URL http(s) ou um deep link do app.',
        );
      }
    }
    const idem = req.headers['idempotency-key'];
    const project = await prisma.project.findUniqueOrThrow({
      where: { id: ctx.project.id },
      include: { org: true },
    });
    const payment = await createAppUserCheckout(prisma, provider, project, appUser, {
      packageId: body.packageId,
      returnUrl,
      name: body.name,
      document: body.document,
      email: body.email,
      idempotencyKey: typeof idem === 'string' && idem.length <= 128 ? idem : undefined,
    });
    return reply.status(201).send(serializeCheckout(payment, opts.appUrl));
  });

  app.get('/checkout/:checkoutId', { schema: { params: checkoutParams } }, async (req) => {
    const ctx = ctxOf(req);
    requireScope(ctx, 'checkout');
    const { checkoutId } = req.params as z.infer<typeof checkoutParams>;
    const payment = await prisma.payment.findUnique({ where: { publicId: checkoutId } });
    // A session token only sees its own end user's checkouts.
    const visible =
      payment &&
      payment.projectId === ctx.project.id &&
      (ctx.kind === 'secret' || payment.appUserId === ctx.appUser?.id);
    if (!visible) throw new GatewayError(404, 'checkout_not_found', 'Checkout não encontrado.');
    return serializeCheckout(payment, opts.appUrl);
  });
};
