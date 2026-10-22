import { microsToBrl } from '@fusai/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { HttpError } from '../../lib/errors';
import { priceModel } from '../../lib/model-pricing';
import { slidingWindow } from '../../lib/rate-limit';
import type { RedisClient } from '../../lib/redis';
import type { SettingsStore } from '../../lib/settings';
import { priceKey } from '../gateway/auto-model';
import { type CatalogStore, isServable } from '../gateway/catalog';
import { minTopupCents } from '../payments/service';

const CACHE_MS = 60_000;

/** Active public models with the list price (global markup) for the landing, /precos and /modelos. */
export async function listPublicModels(catalog: CatalogStore, settings: SettingsStore) {
  const [{ bySlug }, s] = await Promise.all([catalog.get(), settings.get()]);
  return [...bySlug.values()]
    .filter((e) => isServable(e) && e.model.public)
    .map((e) => ({ e, prices: priceModel(e.model, s, null) }))
    .sort((a, b) => {
      const d = priceKey(a.prices) - priceKey(b.prices);
      return d < 0n ? -1 : d > 0n ? 1 : a.e.model.slug.localeCompare(b.e.model.slug);
    })
    .map(({ e, prices }) => ({
      id: e.model.slug,
      name: e.model.displayName,
      provider: e.provider.name,
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

/** GET /public/models: no key, rate limited per IP, cached for a minute. Never exposes cost or markup. */
export const publicModelRoutes: FastifyPluginAsyncZod<{
  redis: RedisClient;
  catalog: CatalogStore;
  settings: SettingsStore;
}> = async (app, { redis, catalog, settings }) => {
  let cache: { body: unknown; expiresAt: number } | null = null;

  app.get('/models', async (req, reply) => {
    const rl = await slidingWindow(redis, `pubmodels:${req.ip}`, 60, 60_000).catch(() => null);
    if (rl && !rl.allowed) {
      reply.header('retry-after', Math.ceil(rl.retryAfterMs / 1000));
      throw new HttpError(429, 'rate_limited', 'Muitas consultas. Aguarde alguns segundos.');
    }
    if (!cache || cache.expiresAt <= Date.now()) {
      const [data, s] = await Promise.all([listPublicModels(catalog, settings), settings.get()]);
      // Public top-up terms for /precos (the same values the checkout enforces).
      const topup = { min_cents: minTopupCents(s), fee_pct: s.topup_fee_pct };
      cache = { body: { object: 'list', data, topup }, expiresAt: Date.now() + CACHE_MS };
    }
    reply.header('cache-control', 'public, max-age=60');
    return cache.body;
  });
};
