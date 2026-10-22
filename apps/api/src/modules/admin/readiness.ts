import type { PrismaClient } from '@fusai/db';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { Env } from '../../lib/env';
import type { RedisClient } from '../../lib/redis';
import { utc } from '../../lib/time';
import { createCircuitBreaker } from '../gateway/circuit-breaker';

type Options = { prisma: PrismaClient; env: Env; redis: RedisClient };

/** The exchange rate is set by hand; older than this it is flagged as stale. */
export const RATE_MAX_AGE_DAYS = 7;
const HEALTH_WINDOW_MS = 24 * 3600_000;

type HealthRow = {
  providerId: string;
  requests: number;
  errors: number;
  p95: number | null;
};

/**
 * "Pronto para vender" checklist (O-10) and per-provider health over the last 24 h (O-11),
 * computed from data the API already has: providers, models, packages, settings and UsageLog.
 */
export const adminReadinessRoutes: FastifyPluginAsyncZod<Options> = async (
  app,
  { prisma, env, redis },
) => {
  const breaker = createCircuitBreaker(redis);

  app.get('/internal/admin/readiness', async () => {
    const [providers, models, packages, rate] = await Promise.all([
      prisma.provider.count({ where: { status: 'ACTIVE', apiKeyEnc: { not: '' } } }),
      prisma.model.findMany({
        where: { active: true, provider: { status: 'ACTIVE', apiKeyEnc: { not: '' } } },
        select: {
          priceMode: true,
          inputCostUsdPerM: true,
          outputCostUsdPerM: true,
          inputPriceMicrosPerM: true,
          outputPriceMicrosPerM: true,
        },
      }),
      prisma.creditPackage.count({ where: { projectId: null, active: true } }),
      prisma.setting.findUnique({ where: { key: 'usd_brl_rate' } }),
    ]);
    const priced = models.filter((m) =>
      m.priceMode === 'FIXED'
        ? m.inputPriceMicrosPerM != null && m.outputPriceMicrosPerM != null
        : m.inputCostUsdPerM.gt(0) || m.outputCostUsdPerM.gt(0),
    ).length;
    const rateAgeDays = rate
      ? Math.floor((Date.now() - rate.updatedAt.getTime()) / 86_400_000)
      : null;
    const asaas = !!env.ASAAS_API_KEY?.startsWith('$aact_');

    const checks = [
      {
        id: 'provider',
        label: 'Provedor ativo com chave',
        ok: providers > 0,
        detail:
          providers > 0 ? `${providers} ativo(s)` : 'Cadastre a chave de um provedor e ative-o',
        href: '/admin/provedores',
      },
      {
        id: 'model',
        label: 'Modelo ativo com preço',
        ok: priced > 0,
        detail: priced > 0 ? `${priced} modelo(s) à venda` : 'Ative ao menos um modelo com custo',
        href: '/admin/modelos',
      },
      {
        id: 'asaas',
        label: 'Pix (Asaas) configurado',
        ok: asaas,
        detail: asaas
          ? env.ASAAS_ENV === 'production'
            ? 'Produção'
            : 'Sandbox (teste)'
          : 'Defina ASAAS_API_KEY no servidor',
        href: null,
      },
      {
        id: 'packages',
        label: 'Pacotes de recarga',
        ok: packages > 0,
        detail: packages > 0 ? `${packages} ativo(s)` : 'Crie ao menos um pacote',
        href: '/admin/pacotes',
      },
      {
        id: 'rate',
        label: 'Câmbio atualizado',
        ok: rateAgeDays != null && rateAgeDays <= RATE_MAX_AGE_DAYS,
        detail:
          rateAgeDays == null
            ? 'Nunca atualizado (valor padrão)'
            : rateAgeDays === 0
              ? 'Atualizado hoje'
              : `Atualizado há ${rateAgeDays} dia(s)`,
        href: '/admin/precos',
      },
    ];
    return { ready: checks.every((c) => c.ok), checks };
  });

  app.get('/internal/admin/providers/health', async () => {
    const since = new Date(Date.now() - HEALTH_WINDOW_MS);
    const [providers, rows] = await Promise.all([
      prisma.provider.findMany({ select: { id: true } }),
      prisma.$queryRaw<HealthRow[]>`
        SELECT "providerId",
               COUNT(*)::int AS requests,
               COUNT(*) FILTER (WHERE status = 'UPSTREAM_ERROR')::int AS errors,
               (percentile_cont(0.95) WITHIN GROUP (ORDER BY "latencyMs")
                  FILTER (WHERE status = 'SUCCESS'))::int AS p95
          FROM "UsageLog"
         WHERE "createdAt" >= ${utc(since)}
           AND status IN ('SUCCESS', 'UPSTREAM_ERROR')
         GROUP BY 1`,
    ]);
    const byId = new Map(rows.map((r) => [r.providerId, r]));
    const health = await Promise.all(
      providers.map(async (p) => {
        const r = byId.get(p.id);
        const requests = r?.requests ?? 0;
        const errors = r?.errors ?? 0;
        return {
          providerId: p.id,
          requests,
          errors,
          // One decimal: 1 error in 3 requests -> "33.3".
          errorPct: requests ? (Math.round((errors * 1000) / requests) / 10).toFixed(1) : null,
          p95LatencyMs: r?.p95 ?? null,
          circuitOpen: await breaker.isOpen(p.id),
        };
      }),
    );
    return { windowHours: 24, providers: health };
  });
};
