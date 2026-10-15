import { Prisma, type PrismaClient } from '@fusai/db';
import { logsQuerySchema, microsToBrl, usageFilterSchema } from '@fusai/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { toCsv } from '../../lib/csv';
import { HttpError } from '../../lib/errors';
import { currentUser } from '../../lib/session';
import type { SettingsStore } from '../../lib/settings';
import { addDays, spDay, spDayOf, spDaysBetween, startOfSpDay, utc } from '../../lib/time';
import { listLedger } from '../billing/wallet';
import { requireMembership } from './membership';

const orgParams = z.object({ orgId: z.string().min(1) });
const MAX_RANGE_DAYS = 366;

type Filter = { orgId: string; from: Date; to: Date; projectId?: string; modelId?: string };

function resolveRange(q: { from?: string; to?: string }, defaultDays = 30) {
  const to = q.to ? new Date(q.to) : new Date();
  const from = q.from ? new Date(q.from) : addDays(startOfSpDay(to), -(defaultDays - 1));
  if (from >= to || to.getTime() - from.getTime() > MAX_RANGE_DAYS * 86_400_000) {
    throw new HttpError(400, 'invalid_range', 'Período inválido (máximo de 366 dias).');
  }
  return { from, to };
}

function where(f: Filter) {
  return Prisma.sql`"orgId" = ${f.orgId}
    AND "createdAt" >= ${utc(f.from)} AND "createdAt" < ${utc(f.to)}
    ${f.projectId ? Prisma.sql`AND "projectId" = ${f.projectId}` : Prisma.empty}
    ${f.modelId ? Prisma.sql`AND "modelId" = ${f.modelId}` : Prisma.empty}`;
}

type DailyRow = {
  day: string;
  requests: number;
  charged: bigint;
  prompt: bigint;
  completion: bigint;
};
type GroupRow = {
  key: string;
  requests: number;
  charged: bigint;
  prompt: bigint;
  completion: bigint;
};

const sums = Prisma.sql`COUNT(*)::int AS requests,
  COALESCE(SUM("chargedMicros"), 0)::bigint AS charged,
  COALESCE(SUM("promptTokens"), 0)::bigint AS prompt,
  COALESCE(SUM("completionTokens"), 0)::bigint AS completion`;

async function daily(prisma: PrismaClient, f: Filter) {
  const rows = await prisma.$queryRaw<DailyRow[]>`
    SELECT ${spDayOf(Prisma.sql`"createdAt"`)} AS day, ${sums}
      FROM "UsageLog" WHERE ${where(f)} GROUP BY 1 ORDER BY 1`;
  const byDay = new Map(rows.map((r) => [r.day, r]));
  // Every day of the range, including days without traffic (charts need the gaps as zeros).
  return spDaysBetween(f.from, f.to).map((day) => {
    const r = byDay.get(day);
    return {
      day,
      requests: r?.requests ?? 0,
      chargedMicros: (r?.charged ?? 0n).toString(),
      promptTokens: Number(r?.prompt ?? 0n),
      completionTokens: Number(r?.completion ?? 0n),
    };
  });
}

async function grouped(prisma: PrismaClient, f: Filter, column: 'modelId' | 'projectId') {
  const col = Prisma.raw(`"${column}"`);
  return prisma.$queryRaw<GroupRow[]>`
    SELECT ${col} AS key, ${sums} FROM "UsageLog" WHERE ${where(f)} GROUP BY 1 ORDER BY charged DESC`;
}

async function labelModels(prisma: PrismaClient, rows: GroupRow[]) {
  const models = await prisma.model.findMany({
    where: { id: { in: rows.map((r) => r.key) } },
    select: { id: true, slug: true, displayName: true },
  });
  const byId = new Map(models.map((m) => [m.id, m]));
  return rows.map((r) => ({
    modelId: r.key,
    slug: byId.get(r.key)?.slug ?? 'modelo removido',
    name: byId.get(r.key)?.displayName ?? 'Modelo removido',
    requests: r.requests,
    chargedMicros: r.charged.toString(),
    promptTokens: Number(r.prompt),
    completionTokens: Number(r.completion),
  }));
}

async function labelProjects(prisma: PrismaClient, rows: GroupRow[]) {
  const projects = await prisma.project.findMany({
    where: { id: { in: rows.map((r) => r.key) } },
    select: { id: true, name: true },
  });
  const byId = new Map(projects.map((p) => [p.id, p.name]));
  return rows.map((r) => ({
    projectId: r.key,
    name: byId.get(r.key) ?? 'Projeto removido',
    requests: r.requests,
    chargedMicros: r.charged.toString(),
    promptTokens: Number(r.prompt),
    completionTokens: Number(r.completion),
  }));
}

async function totals(prisma: PrismaClient, f: Filter) {
  const [row] = await prisma.$queryRaw<Omit<DailyRow, 'day'>[]>`
    SELECT ${sums} FROM "UsageLog" WHERE ${where(f)}`;
  return {
    requests: row?.requests ?? 0,
    chargedMicros: (row?.charged ?? 0n).toString(),
    promptTokens: Number(row?.prompt ?? 0n),
    completionTokens: Number(row?.completion ?? 0n),
  };
}

/** Overview, usage, logs and CSV exports for organization members. */
export const dashboardAnalyticsRoutes: FastifyPluginAsyncZod<{
  prisma: PrismaClient;
  settings: SettingsStore;
}> = async (app, { prisma, settings }) => {
  const member = (req: { params: { orgId: string } } & Parameters<typeof currentUser>[0]) =>
    requireMembership(prisma, currentUser(req).id, req.params.orgId);

  app.get(
    '/internal/organizations/:orgId/overview',
    { schema: { params: orgParams } },
    async (req) => {
      await member(req);
      const orgId = req.params.orgId;
      const org = await prisma.organization.findUniqueOrThrow({
        where: { id: orgId },
        include: { wallet: true },
      });
      const now = new Date();
      const today = startOfSpDay(now);
      const window = (days: number): Filter => ({
        orgId,
        from: addDays(today, -(days - 1)),
        to: now,
      });
      const [d1, d7, d30, series, byModelRaw, s] = await Promise.all([
        totals(prisma, window(1)),
        totals(prisma, window(7)),
        totals(prisma, window(30)),
        daily(prisma, window(30)),
        grouped(prisma, window(30), 'modelId'),
        settings.get(),
      ]);
      const balance = org.wallet?.balanceMicros ?? 0n;
      const reserved = org.wallet?.reservedMicros ?? 0n;
      const threshold = org.lowBalanceAlertMicros ?? BigInt(s.low_balance_threshold_micros);
      return {
        today: spDay(now),
        wallet: {
          balanceMicros: balance.toString(),
          reservedMicros: reserved.toString(),
          availableMicros: (balance - reserved).toString(),
        },
        lowBalance: {
          thresholdMicros: threshold.toString(),
          isLow: org.billingType !== 'INTERNAL' && balance - reserved < threshold,
        },
        billingType: org.billingType,
        spend: { today: d1.chargedMicros, last7d: d7.chargedMicros, last30d: d30.chargedMicros },
        requests: { today: d1.requests, last7d: d7.requests, last30d: d30.requests },
        daily: series,
        byModel: await labelModels(prisma, byModelRaw),
      };
    },
  );

  const usageQuery = usageFilterSchema;
  async function usageFilter(req: {
    params: { orgId: string };
    query: z.infer<typeof usageQuery>;
  }): Promise<Filter> {
    const { from, to } = resolveRange(req.query);
    if (req.query.projectId) {
      const p = await prisma.project.findFirst({
        where: { id: req.query.projectId, orgId: req.params.orgId },
      });
      if (!p) throw new HttpError(404, 'not_found', 'Projeto não encontrado');
    }
    return {
      orgId: req.params.orgId,
      from,
      to,
      projectId: req.query.projectId,
      modelId: req.query.modelId,
    };
  }

  app.get(
    '/internal/organizations/:orgId/usage',
    { schema: { params: orgParams, querystring: usageQuery } },
    async (req) => {
      await member(req);
      const f = await usageFilter(req);
      const [t, series, byModel, byProject] = await Promise.all([
        totals(prisma, f),
        daily(prisma, f),
        grouped(prisma, f, 'modelId'),
        grouped(prisma, f, 'projectId'),
      ]);
      return {
        from: f.from.toISOString(),
        to: f.to.toISOString(),
        totals: t,
        daily: series,
        byModel: await labelModels(prisma, byModel),
        byProject: await labelProjects(prisma, byProject),
      };
    },
  );

  app.get(
    '/internal/organizations/:orgId/usage.csv',
    { schema: { params: orgParams, querystring: usageQuery } },
    async (req, reply) => {
      await member(req);
      const f = await usageFilter(req);
      const rows = await prisma.$queryRaw<(GroupRow & { day: string; project: string })[]>`
        SELECT ${spDayOf(Prisma.sql`"createdAt"`)} AS day, "projectId" AS project, "modelId" AS key, ${sums}
          FROM "UsageLog" WHERE ${where(f)} GROUP BY 1, 2, 3 ORDER BY 1, 2, 3`;
      const [models, projects] = await Promise.all([
        prisma.model.findMany({
          where: { id: { in: rows.map((r) => r.key) } },
          select: { id: true, slug: true },
        }),
        prisma.project.findMany({
          where: { id: { in: rows.map((r) => r.project) } },
          select: { id: true, name: true },
        }),
      ]);
      const slug = new Map(models.map((m) => [m.id, m.slug]));
      const pname = new Map(projects.map((p) => [p.id, p.name]));
      const csv = toCsv(
        ['data', 'projeto', 'modelo', 'requisicoes', 'tokens_entrada', 'tokens_saida', 'valor_brl'],
        rows.map((r) => [
          r.day,
          pname.get(r.project) ?? r.project,
          slug.get(r.key) ?? r.key,
          r.requests,
          r.prompt.toString(),
          r.completion.toString(),
          microsToBrl(r.charged),
        ]),
      );
      return reply
        .header('content-type', 'text/csv; charset=utf-8')
        .header(
          'content-disposition',
          `attachment; filename="consumo-${spDay(f.from)}-a-${spDay(f.to)}.csv"`,
        )
        .send(csv);
    },
  );

  app.get(
    '/internal/organizations/:orgId/logs',
    { schema: { params: orgParams, querystring: logsQuerySchema } },
    async (req) => {
      await member(req);
      const q = req.query;
      const limit = q.limit ?? 50;
      const rows = await prisma.usageLog.findMany({
        where: {
          orgId: req.params.orgId,
          ...(q.projectId ? { projectId: q.projectId } : {}),
          ...(q.modelId ? { modelId: q.modelId } : {}),
          ...(q.status ? { status: q.status } : {}),
          ...(q.from || q.to
            ? {
                createdAt: {
                  ...(q.from ? { gte: new Date(q.from) } : {}),
                  ...(q.to ? { lt: new Date(q.to) } : {}),
                },
              }
            : {}),
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
        ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
      });
      const page = rows.slice(0, limit);
      const [models, projects, keys] = await Promise.all([
        prisma.model.findMany({
          where: { id: { in: page.map((r) => r.modelId) } },
          select: { id: true, slug: true },
        }),
        prisma.project.findMany({
          where: { id: { in: page.map((r) => r.projectId) } },
          select: { id: true, name: true },
        }),
        prisma.apiKey.findMany({
          where: { id: { in: page.flatMap((r) => (r.apiKeyId ? [r.apiKeyId] : [])) } },
          select: { id: true, prefix: true, name: true },
        }),
      ]);
      const slug = new Map(models.map((m) => [m.id, m.slug]));
      const pname = new Map(projects.map((p) => [p.id, p.name]));
      const key = new Map(keys.map((k) => [k.id, k]));
      return {
        items: page.map((r) => ({
          id: r.id,
          requestId: r.requestId,
          createdAt: r.createdAt.toISOString(),
          project: pname.get(r.projectId) ?? 'Projeto removido',
          model: slug.get(r.modelId) ?? 'modelo removido',
          apiKey: r.apiKeyId ? (key.get(r.apiKeyId) ?? null) : null,
          promptTokens: r.promptTokens,
          cachedTokens: r.cachedTokens,
          completionTokens: r.completionTokens,
          chargedMicros: r.chargedMicros.toString(),
          latencyMs: r.latencyMs,
          ttftMs: r.ttftMs,
          stream: r.stream,
          status: r.status,
          errorCode: r.errorCode,
        })),
        nextCursor: rows.length > limit ? (page.at(-1)?.id ?? null) : null,
      };
    },
  );

  app.get(
    '/internal/organizations/:orgId/wallet/ledger.csv',
    { schema: { params: orgParams } },
    async (req, reply) => {
      await member(req);
      const wallet = await prisma.wallet.findUnique({ where: { orgId: req.params.orgId } });
      if (!wallet) throw new HttpError(404, 'not_found', 'Carteira não encontrada');
      const entries: Awaited<ReturnType<typeof listLedger>>['items'] = [];
      let cursor: string | undefined;
      // Stream through the cursor pages (capped to keep exports bounded).
      for (let i = 0; i < 100; i++) {
        const page = await listLedger(prisma, wallet.id, { cursor, limit: 200 });
        entries.push(...page.items);
        if (!page.nextCursor) break;
        cursor = page.nextCursor;
      }
      const csv = toCsv(
        ['data', 'tipo', 'descricao', 'valor_brl', 'saldo_brl', 'referencia'],
        entries.map((e) => [
          e.createdAt,
          e.type,
          e.description ?? '',
          microsToBrl(BigInt(e.amountMicros)),
          microsToBrl(BigInt(e.balanceAfter)),
          e.referenceId ?? '',
        ]),
      );
      return reply
        .header('content-type', 'text/csv; charset=utf-8')
        .header('content-disposition', `attachment; filename="extrato-${spDay(new Date())}.csv"`)
        .send(csv);
    },
  );
};
