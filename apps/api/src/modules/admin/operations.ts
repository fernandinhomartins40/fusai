import type { Prisma, PrismaClient } from '@fusai/db';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { audit } from '../../lib/audit';
import { notFound } from '../../lib/errors';
import type { JobQueue } from '../../lib/jobs';
import type { RedisClient } from '../../lib/redis';

type Options = { prisma: PrismaClient; redis: RedisClient; jobs: JobQueue };

const idParams = z.object({ id: z.string().min(1) });
const startedAt = Date.now();

const webhookQuery = z.object({
  state: z.enum(['pending', 'error', 'processed']).optional(),
  provider: z.string().trim().min(1).max(30).optional(),
  cursor: z.string().min(1).max(64).optional(),
});

const auditQuery = z.object({
  /** Action prefix ("wallet", "org.suspend", "impersonate"...). */
  action: z.string().trim().min(1).max(60).optional(),
  /** Actor email or exact target id. */
  q: z.string().trim().min(1).max(120).optional(),
  cursor: z.string().min(1).max(64).optional(),
});

const PAGE = 50;

/** Never ship payloads that may carry personal data to the browser: only what helps support. */
function webhookSummary(payload: Prisma.JsonValue) {
  const p = (payload ?? {}) as Record<string, unknown>;
  const pick = (k: string) => (typeof p[k] === 'string' || typeof p[k] === 'number' ? p[k] : null);
  return {
    kind: pick('kind'),
    providerPaymentId: pick('providerPaymentId'),
    externalRef: pick('externalRef'),
    valueCents: pick('valueCents'),
  };
}

async function timed<T>(fn: () => Promise<T>) {
  const start = performance.now();
  try {
    await fn();
    return { ok: true, latencyMs: Math.round(performance.now() - start) };
  } catch (err) {
    return { ok: false, latencyMs: null, error: err instanceof Error ? err.message : 'erro' };
  }
}

/** Inbound webhooks (reprocess), audit log and system status (PRD §11.5). */
export const adminOperationsRoutes: FastifyPluginAsyncZod<Options> = async (app, opts) => {
  const { prisma, redis, jobs } = opts;

  app.get(
    '/internal/admin/webhook-events',
    { schema: { querystring: webhookQuery } },
    async (req) => {
      const { state, provider, cursor } = req.query;
      const where: Prisma.InboundWebhookEventWhereInput = {
        ...(provider ? { provider } : {}),
        ...(state === 'pending' ? { processedAt: null, error: null } : {}),
        ...(state === 'error' ? { error: { not: null } } : {}),
        ...(state === 'processed' ? { processedAt: { not: null }, error: null } : {}),
      };
      const rows = await prisma.inboundWebhookEvent.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: PAGE + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      const page = rows.slice(0, PAGE);
      return {
        items: page.map((e) => ({
          id: e.id,
          provider: e.provider,
          type: e.type,
          eventKey: e.eventKey,
          summary: webhookSummary(e.payload),
          processedAt: e.processedAt?.toISOString() ?? null,
          error: e.error,
          createdAt: e.createdAt.toISOString(),
        })),
        nextCursor: rows.length > PAGE ? (page.at(-1)?.id ?? null) : null,
      };
    },
  );

  /**
   * Runs a payment webhook again. Safe: crediting is idempotent (Payment.creditedAt), so a
   * payment is never credited twice.
   */
  app.post(
    '/internal/admin/webhook-events/:id/reprocess',
    { schema: { params: idParams } },
    async (req) => {
      const event = await prisma.inboundWebhookEvent.findUnique({ where: { id: req.params.id } });
      if (event?.provider !== 'asaas') throw notFound('Evento não encontrado');
      await prisma.inboundWebhookEvent.update({
        where: { id: event.id },
        data: { processedAt: null, error: null },
      });
      await jobs.add('process-webhook', { eventId: event.id });
      await audit(prisma, req, 'webhook.reprocess', event.id, { type: event.type });
      return { queued: true };
    },
  );

  app.get('/internal/admin/audit', { schema: { querystring: auditQuery } }, async (req) => {
    const { action, q, cursor } = req.query;
    const actors = q?.includes('@')
      ? await prisma.user.findMany({
          where: { email: { contains: q, mode: 'insensitive' } },
          select: { id: true },
          take: 50,
        })
      : [];
    const where: Prisma.AuditLogWhereInput = {
      ...(action ? { action: { startsWith: action } } : {}),
      ...(q
        ? q.includes('@')
          ? { actorId: { in: actors.map((a) => a.id) } }
          : { OR: [{ target: q }, { actorId: q }] }
        : {}),
    };
    const rows = await prisma.auditLog.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: PAGE + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    const page = rows.slice(0, PAGE);
    const users = await prisma.user.findMany({
      where: { id: { in: [...new Set(page.flatMap((r) => (r.actorId ? [r.actorId] : [])))] } },
      select: { id: true, name: true, email: true },
    });
    const byId = new Map(users.map((u) => [u.id, u]));
    return {
      items: page.map((r) => ({
        id: r.id,
        action: r.action,
        target: r.target,
        actor: r.actorId
          ? (byId.get(r.actorId) ?? { id: r.actorId, name: null, email: null })
          : null,
        metadata: r.metadata,
        ip: r.ip,
        createdAt: r.createdAt.toISOString(),
      })),
      nextCursor: rows.length > PAGE ? (page.at(-1)?.id ?? null) : null,
    };
  });

  app.get('/internal/admin/system', async () => {
    const [database, cache, queue, pendingWebhooks, failedWebhooks, activeHolds, lastMigration] =
      await Promise.all([
        timed(() => prisma.$queryRaw`SELECT 1`),
        timed(() => redis.ping()),
        jobs.counts().catch(() => null),
        prisma.inboundWebhookEvent.count({ where: { processedAt: null } }),
        prisma.outboundWebhook.count({ where: { status: 'failed' } }),
        prisma.walletHold.count(),
        prisma.$queryRaw<{ migration_name: string; finished_at: Date | null }[]>`
          SELECT migration_name, finished_at FROM "_prisma_migrations"
           ORDER BY finished_at DESC NULLS LAST LIMIT 1`.catch(() => []),
      ]);
    return {
      version: process.env.APP_VERSION ?? 'dev',
      node: process.version,
      uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
      time: new Date().toISOString(),
      database,
      redis: cache,
      queue,
      pendingInboundWebhooks: pendingWebhooks,
      failedOutboundWebhooks: failedWebhooks,
      activeHolds,
      lastMigration: lastMigration[0]?.migration_name ?? null,
    };
  });
};
