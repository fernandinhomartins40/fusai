import { Prisma, type PrismaClient } from '@fusai/db';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { audit } from '../../lib/audit';
import { HttpError, notFound } from '../../lib/errors';
import type { JobQueue } from '../../lib/jobs';
import { slidingWindow } from '../../lib/rate-limit';
import type { RedisClient } from '../../lib/redis';
import { currentUser } from '../../lib/session';
import type { SettingsStore } from '../../lib/settings';
import type { PaymentProvider } from '../../payments/types';
import { PaymentProviderError } from '../../payments/types';
import { requireMembership } from '../dashboard/membership';
import { createOrgTopup, MAX_TOPUP_CENTS, minTopupCents, serializePayment } from './service';

/** Public: Asaas → fusai. Persist + 200 immediately, process in the worker (PRD §9.1 step 6). */
export const paymentWebhookRoutes: FastifyPluginAsyncZod<{
  prisma: PrismaClient;
  provider: PaymentProvider;
  jobs: JobQueue;
}> = async (app, { prisma, provider, jobs }) => {
  app.post('/webhooks/asaas', { bodyLimit: 256 * 1024 }, async (req, reply) => {
    const event = await provider.parseWebhook(req.headers, req.body);
    if (!event)
      return reply.status(401).send({ error: { message: 'Token inválido', code: 'unauthorized' } });

    let storedId: string;
    try {
      const stored = await prisma.inboundWebhookEvent.create({
        data: {
          provider: 'asaas',
          eventKey: event.eventKey,
          type: event.type,
          payload: { ...event, raw: req.body as Prisma.InputJsonValue },
        },
      });
      storedId = stored.id;
    } catch (err) {
      // At-least-once delivery: a repeated event id is acknowledged and ignored.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return reply.status(200).send({ received: true, duplicate: true });
      }
      throw err;
    }
    if (event.kind !== 'ignored') {
      await jobs.add('process-webhook', { eventId: storedId }).catch((err) => {
        req.log.error({ err }, 'enqueue failed; the sweep job will process it');
      });
    } else {
      await prisma.inboundWebhookEvent.update({
        where: { id: storedId },
        data: { processedAt: new Date() },
      });
    }
    return reply.status(200).send({ received: true });
  });
};

const BILLING_ROLES = ['OWNER', 'ADMIN', 'BILLING'] as const;

const topupSchema = z
  .object({
    packageId: z.string().min(1).optional(),
    amountCents: z.coerce.number().int().positive().max(MAX_TOPUP_CENTS).optional(),
  })
  .refine((v) => !!v.packageId !== (v.amountCents != null), {
    message: 'Escolha um pacote ou informe um valor',
  });

/** Dashboard: organization top-ups (registered inside the session-guarded dashboard plugin). */
export const dashboardPaymentRoutes: FastifyPluginAsyncZod<{
  prisma: PrismaClient;
  provider: PaymentProvider;
  settings: SettingsStore;
  redis: RedisClient;
}> = async (app, { prisma, provider, settings, redis }) => {
  const orgParams = z.object({ orgId: z.string().min(1) });

  app.get(
    '/internal/organizations/:orgId/topup-options',
    { schema: { params: orgParams } },
    async (req) => {
      const membership = await requireMembership(prisma, currentUser(req).id, req.params.orgId);
      const [org, s, packages] = await Promise.all([
        prisma.organization.findUniqueOrThrow({ where: { id: req.params.orgId } }),
        settings.get(),
        prisma.creditPackage.findMany({
          where: { projectId: null, active: true },
          orderBy: [{ sortOrder: 'asc' }, { priceCents: 'asc' }],
        }),
      ]);
      return {
        canTopup:
          BILLING_ROLES.includes(membership.role as never) && org.billingType !== 'INTERNAL',
        hasDocument: !!org.document,
        minTopupCents: minTopupCents(s),
        maxTopupCents: MAX_TOPUP_CENTS,
        feePct: s.topup_fee_pct,
        suggestedTopupCents: org.suggestedTopupCents,
        packages: packages.map((p) => ({
          id: p.id,
          name: p.name,
          priceCents: p.priceCents,
          creditMicros: p.creditMicros.toString(),
          bonusMicros: p.bonusMicros.toString(),
          highlight: p.highlight,
        })),
      };
    },
  );

  app.post(
    '/internal/organizations/:orgId/topups',
    { schema: { params: orgParams, body: topupSchema } },
    async (req, reply) => {
      const user = currentUser(req);
      await requireMembership(prisma, user.id, req.params.orgId, BILLING_ROLES);
      const rl = await slidingWindow(redis, `topup:${user.id}`, 10, 60_000).catch(() => null);
      if (rl && !rl.allowed)
        throw new HttpError(
          429,
          'rate_limited',
          'Muitas recargas em sequência. Aguarde um minuto.',
        );
      const key = req.headers['idempotency-key'];
      try {
        const payment = await createOrgTopup(
          prisma,
          provider,
          await settings.get(),
          req.params.orgId,
          {
            ...req.body,
            idempotencyKey: typeof key === 'string' && key.length <= 100 ? key : undefined,
          },
        );
        await audit(prisma, req, 'payment.create', payment.id, {
          orgId: req.params.orgId,
          amountCents: payment.amountCents,
        });
        return reply.status(201).send(serializePayment(payment));
      } catch (err) {
        if (err instanceof PaymentProviderError) {
          req.log.error({ err: { message: err.message, status: err.status } }, 'asaas error');
          throw new HttpError(
            502,
            'payment_provider_error',
            'Não foi possível gerar o Pix agora. Tente novamente em instantes.',
          );
        }
        throw err;
      }
    },
  );

  app.get(
    '/internal/payments/:id',
    { schema: { params: z.object({ id: z.string().min(1) }) } },
    async (req) => {
      const payment = await prisma.payment.findUnique({ where: { id: req.params.id } });
      if (!payment) throw notFound('Pagamento não encontrado');
      await requireMembership(prisma, currentUser(req).id, payment.orgId);
      return serializePayment(payment);
    },
  );

  app.get(
    '/internal/organizations/:orgId/payments',
    {
      schema: {
        params: orgParams,
        querystring: z.object({
          cursor: z.string().optional(),
          limit: z.coerce.number().int().min(1).max(100).optional(),
        }),
      },
    },
    async (req) => {
      await requireMembership(prisma, currentUser(req).id, req.params.orgId);
      const limit = req.query.limit ?? 20;
      const rows = await prisma.payment.findMany({
        where: { orgId: req.params.orgId, appUserId: null },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
        ...(req.query.cursor ? { cursor: { id: req.query.cursor }, skip: 1 } : {}),
      });
      const page = rows.slice(0, limit);
      return {
        items: page.map(serializePayment),
        nextCursor: rows.length > limit ? (page.at(-1)?.id ?? null) : null,
      };
    },
  );
};

/** Admin: refund at the PSP; the PAYMENT_REFUNDED webhook then debits the wallet. */
export const adminPaymentRoutes: FastifyPluginAsyncZod<{
  prisma: PrismaClient;
  provider: PaymentProvider;
}> = async (app, { prisma, provider }) => {
  app.get(
    '/internal/admin/payments',
    {
      schema: {
        querystring: z.object({
          status: z
            .enum(['PENDING', 'CONFIRMED', 'RECEIVED', 'EXPIRED', 'REFUNDED', 'FAILED', 'CANCELED'])
            .optional(),
          orgId: z.string().min(1).max(64).optional(),
          cursor: z.string().optional(),
        }),
      },
    },
    async (req) => {
      const { status, orgId } = req.query;
      const rows = await prisma.payment.findMany({
        where: { ...(status ? { status } : {}), ...(orgId ? { orgId } : {}) },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 51,
        include: { org: { select: { id: true, name: true } } },
        ...(req.query.cursor ? { cursor: { id: req.query.cursor }, skip: 1 } : {}),
      });
      const page = rows.slice(0, 50);
      return {
        items: page.map((p) => ({
          ...serializePayment(p),
          org: p.org,
          providerPaymentId: p.providerPaymentId,
        })),
        nextCursor: rows.length > 50 ? (page.at(-1)?.id ?? null) : null,
      };
    },
  );

  app.post(
    '/internal/admin/payments/:id/refund',
    { schema: { params: z.object({ id: z.string().min(1) }) } },
    async (req) => {
      const payment = await prisma.payment.findUnique({ where: { id: req.params.id } });
      if (!payment?.providerPaymentId) throw notFound('Pagamento não encontrado');
      if (!payment.creditedAt || payment.status === 'REFUNDED') {
        throw new HttpError(
          409,
          'not_refundable',
          'Só pagamentos creditados e ainda não estornados.',
        );
      }
      // Never refund credits that were already consumed: the customer would owe (D-128).
      const wallet = await prisma.wallet.findUnique({ where: { id: payment.walletId } });
      const available = (wallet?.balanceMicros ?? 0n) - (wallet?.reservedMicros ?? 0n);
      if (available < payment.creditMicros - payment.refundedMicros) {
        throw new HttpError(
          409,
          'credits_already_used',
          'O cliente já usou parte destes créditos: o estorno deixaria o saldo negativo. Estorne no Asaas só o valor não usado: a fusai desconta a parte proporcional dos créditos automaticamente.',
        );
      }
      try {
        await provider.refund(payment.providerPaymentId);
      } catch (err) {
        if (err instanceof PaymentProviderError)
          throw new HttpError(502, 'payment_provider_error', err.message);
        throw err;
      }
      await audit(prisma, req, 'payment.refund_requested', payment.id, {
        orgId: payment.orgId,
        amountCents: payment.amountCents,
      });
      return { requested: true };
    },
  );
};

const publicIdParams = z.object({ publicId: z.string().regex(/^chk_[A-Za-z0-9_-]{16,40}$/) });

/**
 * Public, unauthenticated: the hosted checkout page `/pay/{publicId}` (PRD §9.3). The random
 * publicId is the capability; only what the buyer needs to pay is exposed. 30 req/min per IP.
 */
export const publicCheckoutRoutes: FastifyPluginAsyncZod<{
  prisma: PrismaClient;
  redis: RedisClient;
}> = async (app, { prisma, redis }) => {
  app.get('/checkout/:publicId', { schema: { params: publicIdParams } }, async (req, reply) => {
    const rl = await slidingWindow(redis, `pubchk:${req.ip}`, 30, 60_000).catch(() => null);
    if (rl && !rl.allowed) {
      reply.header('retry-after', Math.ceil(rl.retryAfterMs / 1000));
      throw new HttpError(429, 'rate_limited', 'Muitas consultas. Aguarde alguns segundos.');
    }
    reply.header('cache-control', 'no-store');
    const payment = await prisma.payment.findUnique({
      where: { publicId: req.params.publicId },
      include: { org: { select: { name: true } } },
    });
    // End-user checkouts and organization top-ups; legacy payments without publicId never match.
    if (!payment) throw notFound('Checkout não encontrado');
    const project = payment.projectId
      ? await prisma.project.findUnique({
          where: { id: payment.projectId },
          select: { name: true },
        })
      : null;
    const meta = (payment.metadata ?? {}) as { packageName?: string; returnUrl?: string };
    const pending = payment.status === 'PENDING';
    return {
      checkoutId: payment.publicId,
      status: payment.status,
      amountCents: payment.amountCents,
      creditMicros: payment.creditMicros.toString(),
      packageName: meta.packageName ?? null,
      // A top-up is the customer paying fusai; a checkout is an end user paying the app.
      merchantName: payment.projectId ? (project?.name ?? payment.org.name) : 'fusai',
      copyPaste: pending ? payment.pixCopyPaste : null,
      qrBase64: pending ? payment.pixQrBase64 : null,
      expiresAt: payment.expiresAt?.toISOString() ?? null,
      paidAt: payment.paidAt?.toISOString() ?? null,
      returnUrl: meta.returnUrl ?? null,
    };
  });
};
