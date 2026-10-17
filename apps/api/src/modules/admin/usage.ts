import type { Prisma, PrismaClient } from '@fusai/db';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

const usageQuery = z.object({
  orgId: z.string().min(1).max(64).optional(),
  modelId: z.string().min(1).max(64).optional(),
  providerId: z.string().min(1).max(64).optional(),
  status: z
    .enum(['SUCCESS', 'UPSTREAM_ERROR', 'CLIENT_ERROR', 'INSUFFICIENT_FUNDS', 'RATE_LIMITED'])
    .optional(),
  /** Exact request id (support tickets quote the x-fuse-request-id header). */
  requestId: z.string().trim().min(1).max(100).optional(),
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
  cursor: z.string().min(1).max(64).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

/** Usage explorer across every customer: cost, charge and margin per request. */
export const adminUsageRoutes: FastifyPluginAsyncZod<{ prisma: PrismaClient }> = async (
  app,
  { prisma },
) => {
  app.get('/internal/admin/usage', { schema: { querystring: usageQuery } }, async (req) => {
    const q = req.query;
    const limit = q.limit ?? 50;
    const where: Prisma.UsageLogWhereInput = {
      ...(q.orgId ? { orgId: q.orgId } : {}),
      ...(q.modelId ? { modelId: q.modelId } : {}),
      ...(q.providerId ? { providerId: q.providerId } : {}),
      ...(q.status ? { status: q.status } : {}),
      ...(q.requestId ? { requestId: q.requestId } : {}),
      ...(q.from || q.to
        ? {
            createdAt: {
              ...(q.from ? { gte: new Date(q.from) } : {}),
              ...(q.to ? { lt: new Date(q.to) } : {}),
            },
          }
        : {}),
    };
    const rows = await prisma.usageLog.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
    });
    const page = rows.slice(0, limit);
    const ids = <K extends keyof (typeof page)[number]>(k: K) => [
      ...new Set(page.map((r) => r[k] as string)),
    ];
    const [orgs, models, providers] = await Promise.all([
      prisma.organization.findMany({
        where: { id: { in: ids('orgId') } },
        select: { id: true, name: true },
      }),
      prisma.model.findMany({
        where: { id: { in: ids('modelId') } },
        select: { id: true, slug: true },
      }),
      prisma.provider.findMany({
        where: { id: { in: ids('providerId') } },
        select: { id: true, name: true },
      }),
    ]);
    const org = new Map(orgs.map((o) => [o.id, o.name]));
    const model = new Map(models.map((m) => [m.id, m.slug]));
    const provider = new Map(providers.map((p) => [p.id, p.name]));
    return {
      items: page.map((r) => ({
        id: r.id,
        requestId: r.requestId,
        createdAt: r.createdAt.toISOString(),
        org: { id: r.orgId, name: org.get(r.orgId) ?? 'Cliente removido' },
        model: model.get(r.modelId) ?? 'modelo removido',
        provider: provider.get(r.providerId) ?? 'Provedor removido',
        promptTokens: r.promptTokens,
        cachedTokens: r.cachedTokens,
        completionTokens: r.completionTokens,
        costMicros: r.costBrlMicros.toString(),
        chargedMicros: r.chargedMicros.toString(),
        latencyMs: r.latencyMs,
        stream: r.stream,
        status: r.status,
        errorCode: r.errorCode,
        endUser: !!r.appUserId,
      })),
      nextCursor: rows.length > limit ? (page.at(-1)?.id ?? null) : null,
    };
  });
};
