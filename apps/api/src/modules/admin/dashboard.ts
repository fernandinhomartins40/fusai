import { Prisma, type PrismaClient } from '@fusai/db';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { addDays, spDayOf, spDaysBetween, startOfSpDay, utc } from '../../lib/time';

const dashboardQuery = z.object({
  days: z.coerce
    .number()
    .int()
    .refine((d) => [1, 7, 30, 90].includes(d), 'Período inválido'),
});

/** Gross margin in percent with one decimal ("37.5"), from integer micros (no floats). */
export function marginPct(chargedMicros: bigint, costMicros: bigint): string | null {
  if (chargedMicros <= 0n) return null;
  const tenths = ((chargedMicros - costMicros) * 1000n) / chargedMicros;
  const sign = tenths < 0n ? '-' : '';
  const abs = tenths < 0n ? -tenths : tenths;
  return `${sign}${abs / 10n}.${abs % 10n}`;
}

type UsageTotals = {
  requests: number;
  errors: number;
  charged: bigint;
  cost: bigint;
};

const usageSums = Prisma.sql`COUNT(*)::int AS requests,
  COUNT(*) FILTER (WHERE status = 'UPSTREAM_ERROR')::int AS errors,
  COALESCE(SUM("chargedMicros"), 0)::bigint AS charged,
  COALESCE(SUM("costBrlMicros"), 0)::bigint AS cost`;

const money = (r: { charged: bigint; cost: bigint }) => ({
  chargedMicros: r.charged.toString(),
  costMicros: r.cost.toString(),
  marginMicros: (r.charged - r.cost).toString(),
  marginPct: marginPct(r.charged, r.cost),
});

/** Super admin dashboard (PRD §11.5): revenue, cost, margin, top customers/models, health. */
export const adminDashboardRoutes: FastifyPluginAsyncZod<{ prisma: PrismaClient }> = async (
  app,
  { prisma },
) => {
  app.get(
    '/internal/admin/dashboard',
    { schema: { querystring: dashboardQuery.partial() } },
    async (req) => {
      const days = req.query.days ?? 30;
      const to = new Date();
      const from = addDays(startOfSpDay(to), -(days - 1));
      const inRange = Prisma.sql`"createdAt" >= ${utc(from)} AND "createdAt" < ${utc(to)}`;

      const [
        [totals],
        daily,
        revenueDaily,
        [revenue],
        topOrgs,
        topModels,
        providers,
        liability,
        [recent],
        counts,
      ] = await Promise.all([
        prisma.$queryRaw<UsageTotals[]>`SELECT ${usageSums} FROM "UsageLog" WHERE ${inRange}`,
        prisma.$queryRaw<(UsageTotals & { day: string })[]>`
          SELECT ${spDayOf(Prisma.sql`"createdAt"`)} AS day, ${usageSums}
            FROM "UsageLog" WHERE ${inRange} GROUP BY 1`,
        prisma.$queryRaw<{ day: string; cents: bigint }[]>`
          SELECT ${spDayOf(Prisma.sql`"creditedAt"`)} AS day, SUM("amountCents")::bigint AS cents
            FROM "Payment"
           WHERE "creditedAt" >= ${utc(from)} AND "creditedAt" < ${utc(to)}
           GROUP BY 1`,
        prisma.$queryRaw<{ received: bigint; refunded: bigint; count: number }[]>`
          SELECT COALESCE(SUM("amountCents"), 0)::bigint AS received,
                 COALESCE(SUM("amountCents") FILTER (WHERE status = 'REFUNDED'), 0)::bigint AS refunded,
                 COUNT(*)::int AS count
            FROM "Payment"
           WHERE "creditedAt" >= ${utc(from)} AND "creditedAt" < ${utc(to)}`,
        prisma.$queryRaw<(UsageTotals & { key: string })[]>`
          SELECT "orgId" AS key, ${usageSums} FROM "UsageLog" WHERE ${inRange}
           GROUP BY 1 ORDER BY charged DESC LIMIT 5`,
        prisma.$queryRaw<(UsageTotals & { key: string })[]>`
          SELECT "modelId" AS key, ${usageSums} FROM "UsageLog" WHERE ${inRange}
           GROUP BY 1 ORDER BY charged DESC LIMIT 5`,
        prisma.$queryRaw<(UsageTotals & { key: string; latency: number | null })[]>`
          SELECT "providerId" AS key, ${usageSums},
                 (AVG("latencyMs") FILTER (WHERE status = 'SUCCESS'))::int AS latency
            FROM "UsageLog" WHERE ${inRange} GROUP BY 1`,
        prisma.wallet.groupBy({
          by: ['ownerType'],
          where: { balanceMicros: { gt: 0 } },
          _sum: { balanceMicros: true },
        }),
        prisma.$queryRaw<{ requests: number }[]>`
          SELECT COUNT(*)::int AS requests FROM "UsageLog"
           WHERE "createdAt" >= ${utc(new Date(to.getTime() - 5 * 60_000))}`,
        Promise.all([
          prisma.organization.count(),
          prisma.organization.count({ where: { status: 'SUSPENDED' } }),
          prisma.organization.count({ where: { createdAt: { gte: from } } }),
          prisma.user.count(),
          prisma.provider.count({ where: { status: 'ACTIVE' } }),
          prisma.model.count({ where: { active: true } }),
        ]),
      ]);

      const [orgs, models, providerRows] = await Promise.all([
        prisma.organization.findMany({
          where: { id: { in: topOrgs.map((r) => r.key) } },
          select: { id: true, name: true },
        }),
        prisma.model.findMany({
          where: { id: { in: topModels.map((r) => r.key) } },
          select: { id: true, slug: true, displayName: true },
        }),
        prisma.provider.findMany({
          select: { id: true, name: true, slug: true, status: true },
          orderBy: { priority: 'asc' },
        }),
      ]);
      const orgName = new Map(orgs.map((o) => [o.id, o.name]));
      const modelById = new Map(models.map((m) => [m.id, m]));
      const byDay = new Map(daily.map((d) => [d.day, d]));
      const revenueByDay = new Map(revenueDaily.map((d) => [d.day, d.cents]));
      const providerUsage = new Map(providers.map((p) => [p.key, p]));
      const zero: UsageTotals = { requests: 0, errors: 0, charged: 0n, cost: 0n };
      const t = totals ?? zero;
      const liabilityOf = (type: 'ORGANIZATION' | 'APP_USER') =>
        liability.find((l) => l.ownerType === type)?._sum.balanceMicros ?? 0n;
      const [organizations, suspended, newOrganizations, users, activeProviders, activeModels] =
        counts;

      return {
        days,
        from: from.toISOString(),
        to: to.toISOString(),
        totals: {
          requests: t.requests,
          errors: t.errors,
          ...money(t),
          receivedCents: Number(revenue?.received ?? 0n),
          refundedCents: Number(revenue?.refunded ?? 0n),
          payments: revenue?.count ?? 0,
        },
        daily: spDaysBetween(from, to).map((day) => {
          const d = byDay.get(day) ?? zero;
          return {
            day,
            requests: d.requests,
            ...money(d),
            receivedCents: Number(revenueByDay.get(day) ?? 0n),
          };
        }),
        topCustomers: topOrgs.map((r) => ({
          orgId: r.key,
          name: orgName.get(r.key) ?? 'Cliente removido',
          requests: r.requests,
          ...money(r),
        })),
        topModels: topModels.map((r) => ({
          modelId: r.key,
          slug: modelById.get(r.key)?.slug ?? 'modelo removido',
          name: modelById.get(r.key)?.displayName ?? 'Modelo removido',
          requests: r.requests,
          ...money(r),
        })),
        providers: providerRows.map((p) => {
          const u = providerUsage.get(p.id);
          return {
            id: p.id,
            name: p.name,
            slug: p.slug,
            status: p.status,
            requests: u?.requests ?? 0,
            errors: u?.errors ?? 0,
            avgLatencyMs: u?.latency ?? null,
          };
        }),
        liability: {
          organizationsMicros: liabilityOf('ORGANIZATION').toString(),
          endUsersMicros: liabilityOf('APP_USER').toString(),
        },
        requestsPerMinute: Math.round(((recent?.requests ?? 0) / 5) * 10) / 10,
        counts: {
          organizations,
          suspended,
          newOrganizations,
          users,
          activeProviders,
          activeModels,
        },
      };
    },
  );
};
