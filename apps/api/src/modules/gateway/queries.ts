import type { Organization, PrismaClient, Project } from '@fuseai/db';
import { microsToBrl } from '@fuseai/shared';
import { priceModel } from '../../lib/model-pricing';
import type { SettingsStore } from '../../lib/settings';
import type { GatewayContext } from './auth';
import { type CatalogStore, isServable } from './catalog';

/** Models this credential may use, with BRL prices (shared by GET /v1/models and MCP). */
export async function listModelsFor(
  ctx: { org: Organization; project: Project; env: GatewayContext['env'] },
  catalog: CatalogStore,
  settings: SettingsStore,
) {
  const [{ bySlug }, s] = await Promise.all([catalog.get(), settings.get()]);
  const markup = ctx.org.markupOverride?.toFixed() ?? null;
  return [...bySlug.values()]
    .filter(isServable)
    .filter(
      (e) =>
        ctx.project.allowedModelIds.length === 0 ||
        ctx.project.allowedModelIds.includes(e.model.id),
    )
    .map((e) => ({ e, prices: priceModel(e.model, s, markup) }))
    .filter(
      ({ prices }) =>
        ctx.env === 'LIVE' || prices.outputPerM <= BigInt(s.test_key_max_output_micros),
    )
    .sort(
      (a, b) =>
        a.e.model.sortOrder - b.e.model.sortOrder || a.e.model.slug.localeCompare(b.e.model.slug),
    )
    .map(({ e, prices }) => ({
      id: e.model.slug,
      object: 'model' as const,
      created: 0,
      owned_by: 'fuseai',
      name: e.model.displayName,
      description: e.model.description,
      context_window: e.model.contextWindow,
      max_output_tokens: e.model.maxOutputTokens,
      capabilities: {
        tools: e.model.supportsTools,
        vision: e.model.supportsVision,
        reasoning: e.model.supportsReasoning,
      },
      pricing: {
        currency: 'BRL' as const,
        unit: '1M tokens' as const,
        input: microsToBrl(prices.inputPerM),
        cached_input: microsToBrl(prices.cachedInputPerM),
        output: microsToBrl(prices.outputPerM),
      },
    }));
}

/** Project consumption per model in [from, to) (shared by GET /v1/usage and MCP). */
export async function usageSummary(
  prisma: PrismaClient,
  catalog: CatalogStore,
  projectId: string,
  from: Date,
  to: Date,
) {
  const [rows, { byId }] = await Promise.all([
    prisma.usageLog.groupBy({
      by: ['modelId'],
      where: { projectId, createdAt: { gte: from, lt: to } },
      _count: { _all: true },
      _sum: { promptTokens: true, cachedTokens: true, completionTokens: true, chargedMicros: true },
    }),
    catalog.get(),
  ]);
  const byModel = rows.map((r) => ({
    model: byId.get(r.modelId)?.model.slug ?? r.modelId,
    requests: r._count._all,
    prompt_tokens: r._sum.promptTokens ?? 0,
    cached_tokens: r._sum.cachedTokens ?? 0,
    completion_tokens: r._sum.completionTokens ?? 0,
    charged_micros: (r._sum.chargedMicros ?? 0n).toString(),
  }));
  const total = byModel.reduce(
    (acc, m) => ({
      requests: acc.requests + m.requests,
      prompt_tokens: acc.prompt_tokens + m.prompt_tokens,
      completion_tokens: acc.completion_tokens + m.completion_tokens,
      charged_micros: acc.charged_micros + BigInt(m.charged_micros),
    }),
    { requests: 0, prompt_tokens: 0, completion_tokens: 0, charged_micros: 0n },
  );
  return {
    object: 'usage' as const,
    currency: 'BRL' as const,
    from: from.toISOString(),
    to: to.toISOString(),
    total: {
      ...total,
      charged: microsToBrl(total.charged_micros),
      charged_micros: total.charged_micros.toString(),
    },
    by_model: byModel,
  };
}
