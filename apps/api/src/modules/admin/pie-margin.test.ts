import type { Model, Provider } from '@fusai/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  APP_URL,
  createFundedOrg,
  createTestApp,
  createUserSession,
  resetDb,
} from '../../../test/helpers';
import { autoCandidates } from '../gateway/auto-model';
import type { CatalogEntry } from '../gateway/catalog';

/** PIE R-10: prices below the provider cost need an explicit confirmation. */
describe('PIE R-10: negative margin', () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let admin: string;

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(async () => {
    await ctx.app.close();
  });
  beforeEach(async () => {
    await resetDb();
    admin = await createUserSession(ctx.app, 'admin@example.com', 'SUPER_ADMIN');
  });

  const call = (method: 'POST' | 'PATCH', url: string, payload: object) =>
    ctx.app.inject({ method, url, payload, headers: { cookie: admin, origin: APP_URL } });

  async function providerId() {
    const p = await ctx.prisma.provider.create({
      data: { slug: 'deepseek', name: 'DeepSeek', baseUrl: 'https://x.test', apiKeyEnc: '' },
    });
    return p.id;
  }

  const payload = (pid: string, extra: object = {}) => ({
    slug: 'fuse/deepseek-chat',
    displayName: 'DeepSeek Chat',
    providerId: pid,
    upstreamModel: 'deepseek-chat',
    contextWindow: 128000,
    inputCostUsdPerM: '0.27',
    outputCostUsdPerM: '1.10',
    ...extra,
  });

  it('refuses a markup below 1× unless confirmed', async () => {
    const pid = await providerId();
    const refused = await call(
      'POST',
      '/internal/admin/models',
      payload(pid, { markupMultiplier: '0.8' }),
    );
    expect(refused.statusCode).toBe(400);
    expect(refused.json().error.code ?? refused.json().code).toBe('negative_margin');
    expect(await ctx.prisma.model.count()).toBe(0);

    const confirmed = await call(
      'POST',
      '/internal/admin/models',
      payload(pid, { markupMultiplier: '0.8', allowNegativeMargin: true }),
    );
    expect(confirmed.statusCode).toBe(201);
  });

  it('refuses a fixed price below cost on update and keeps the old record', async () => {
    const pid = await providerId();
    const created = await call('POST', '/internal/admin/models', payload(pid));
    expect(created.statusCode).toBe(201);
    const id = created.json().id;

    const refused = await call('PATCH', `/internal/admin/models/${id}`, {
      priceMode: 'FIXED',
      inputPriceMicrosPerM: '1',
      outputPriceMicrosPerM: '1',
    });
    expect(refused.statusCode).toBe(400);
    expect((await ctx.prisma.model.findUniqueOrThrow({ where: { id } })).priceMode).toBe('AUTO');
  });

  it('refuses an org markup below 1× unless confirmed', async () => {
    const { org } = await createFundedOrg();
    const url = `/internal/admin/organizations/${org.id}`;
    expect((await call('PATCH', url, { markupOverride: '0.5' })).statusCode).toBe(400);
    const ok = await call('PATCH', url, { markupOverride: '0.5', allowNegativeMargin: true });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().markupOverride).toBe('0.5');
    expect((await call('PATCH', url, { markupOverride: '1.2' })).statusCode).toBe(200);
  });

  it('fuse/auto skips models sold below cost', () => {
    const model = (slug: string, outputPrice: bigint): CatalogEntry => ({
      model: {
        slug,
        supportsTools: true,
        supportsVision: true,
        priceMode: 'FIXED',
        inputCostUsdPerM: { toFixed: () => '1' },
        cachedInputCostUsdPerM: null,
        outputCostUsdPerM: { toFixed: () => '1' },
        markupMultiplier: null,
        inputPriceMicrosPerM: 10_000_000n,
        outputPriceMicrosPerM: outputPrice,
      } as unknown as Model,
      provider: {} as Provider,
      apiKey: null,
    });
    const loss = model('loss', 1n); // R$ 0,000001/1M vs R$ 5,50/1M of cost
    const fair = model('fair', 10_000_000n);
    const pricesOf = (e: CatalogEntry) => ({
      inputPerM: e.model.inputPriceMicrosPerM as bigint,
      outputPerM: e.model.outputPriceMicrosPerM as bigint,
    });
    const needs = { tools: false, vision: false };
    expect(autoCandidates([loss, fair], needs, pricesOf).map((e) => e.model.slug)[0]).toBe('loss');
    expect(autoCandidates([loss, fair], needs, pricesOf, '5.5').map((e) => e.model.slug)).toEqual([
      'fair',
    ]);
  });
});
