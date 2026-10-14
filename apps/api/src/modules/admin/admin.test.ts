import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { startFakeUpstream } from '../../../test/fake-upstream';
import { APP_URL, createTestApp, createUserSession, resetDb } from '../../../test/helpers';

const KEY = 'sk-deepseek-test-1234567890abcd';

describe('admin: providers, models and prices', () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let upstream: Awaited<ReturnType<typeof startFakeUpstream>>;
  let admin: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    upstream = await startFakeUpstream(KEY, ['deepseek-reasoner', 'deepseek-chat']);
  });
  afterAll(async () => {
    await upstream.close();
    await ctx.app.close();
  });
  beforeEach(async () => {
    await resetDb();
    admin = await createUserSession(ctx.app, 'admin@example.com', 'SUPER_ADMIN');
  });

  const call = (
    method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
    url: string,
    payload?: object,
    cookie = admin,
  ) => ctx.app.inject({ method, url, payload, headers: { cookie, origin: APP_URL } });

  async function createProvider(extra: object = {}) {
    const res = await call('POST', '/internal/admin/providers', {
      slug: 'deepseek',
      name: 'DeepSeek',
      baseUrl: upstream.baseUrl,
      apiKey: KEY,
      ...extra,
    });
    expect(res.statusCode).toBe(201);
    return res.json();
  }

  const modelPayload = (providerId: string) => ({
    slug: 'fuse/deepseek-chat',
    displayName: 'DeepSeek Chat',
    providerId,
    upstreamModel: 'deepseek-chat',
    contextWindow: 128000,
    inputCostUsdPerM: '0.27',
    cachedInputCostUsdPerM: '0.07',
    outputCostUsdPerM: '0.66',
  });

  it('stores provider keys encrypted and only returns a mask', async () => {
    const provider = await createProvider();
    expect(provider).toMatchObject({ hasKey: true, keyMask: 'sk-…abcd', status: 'DISABLED' });
    expect(JSON.stringify(provider)).not.toContain(KEY);

    const row = await ctx.prisma.provider.findUniqueOrThrow({ where: { id: provider.id } });
    expect(row.apiKeyEnc).not.toContain(KEY);
    expect(row.apiKeyEnc.startsWith('v1.')).toBe(true);

    const list = await call('GET', '/internal/admin/providers');
    expect(list.body).not.toContain(KEY);

    const audits = await ctx.prisma.auditLog.findMany();
    expect(audits.map((a) => a.action)).toContain('provider.create');
    expect(JSON.stringify(audits)).not.toContain(KEY);
  });

  it('refuses to activate a provider without a key', async () => {
    const res = await call('POST', '/internal/admin/providers', {
      slug: 'qwen',
      name: 'Qwen',
      baseUrl: upstream.baseUrl,
      status: 'ACTIVE',
    });
    expect(res.statusCode).toBe(400);
  });

  it('tests the connection and lists upstream models', async () => {
    const provider = await createProvider();
    const ok = await call('POST', `/internal/admin/providers/${provider.id}/test`);
    expect(ok.json()).toMatchObject({
      ok: true,
      status: 200,
      models: ['deepseek-chat', 'deepseek-reasoner'],
    });

    const wrongKey = 'sk-wrong-key-0000000000';
    await call('PATCH', `/internal/admin/providers/${provider.id}`, { apiKey: wrongKey });
    const bad = await call('POST', `/internal/admin/providers/${provider.id}/test`);
    expect(bad.json()).toMatchObject({ ok: false, status: 401 });
    expect(bad.body).not.toContain(wrongKey);
    expect(bad.json().error).toContain('[redacted]');
  });

  it('activates a model and shows the BRL price computed from cost × rate × markup', async () => {
    const provider = await createProvider({ status: 'ACTIVE' });
    const created = await call('POST', '/internal/admin/models', modelPayload(provider.id));
    expect(created.statusCode).toBe(201);
    const model = created.json();
    expect(model.active).toBe(false);
    // Defaults: rate 5.50, markup 4.0 -> output 0.66 × 5.5 × 4 = R$ 14,52 / 1M
    expect(model.pricing).toMatchObject({
      markup: '4.0',
      inputPerM: '5940000',
      cachedInputPerM: '1540000',
      outputPerM: '14520000',
      outputCostBrlPerM: '3630000',
      outputMarginBps: 7500,
    });

    // PATCH only `active` must not reset other fields (zod partial/default pitfall).
    await call('PATCH', `/internal/admin/models/${model.id}`, { markupMultiplier: '3' });
    const activated = await call('PATCH', `/internal/admin/models/${model.id}`, { active: true });
    expect(activated.json()).toMatchObject({
      active: true,
      markupMultiplier: '3',
      priceMode: 'AUTO',
    });
    expect(activated.json().pricing.outputPerM).toBe('10890000');
  });

  it('applies new global settings immediately', async () => {
    const provider = await createProvider();
    const model = (await call('POST', '/internal/admin/models', modelPayload(provider.id))).json();

    const bad = await call('PUT', '/internal/admin/settings', {
      usd_brl_rate: '0',
      default_markup: '4',
      topup_fee_pct: '0',
      min_topup_cents: 1000,
      low_balance_threshold_micros: '5000000',
      welcome_bonus_micros: '0',
    });
    expect(bad.statusCode).toBe(400);

    const saved = await call('PUT', '/internal/admin/settings', {
      usd_brl_rate: '6,00',
      default_markup: '4',
      topup_fee_pct: '2.5',
      min_topup_cents: 2000,
      low_balance_threshold_micros: '5000000',
      welcome_bonus_micros: '1000000',
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json()).toMatchObject({
      usd_brl_rate: '6.00',
      topup_fee_pct: '2.5',
      min_topup_cents: 2000,
    });

    const after = await call('GET', `/internal/admin/models/${model.id}`);
    expect(after.json().pricing.outputPerM).toBe('15840000'); // 0.66 × 6 × 4
    const audit = await ctx.prisma.auditLog.findFirst({ where: { action: 'settings.update' } });
    expect(audit?.metadata).toMatchObject({ usd_brl_rate: { from: '5.50', to: '6.00' } });
  });

  it('validates fixed prices, fallbacks and deletion', async () => {
    const provider = await createProvider();
    const fixedMissing = await call('POST', '/internal/admin/models', {
      ...modelPayload(provider.id),
      priceMode: 'FIXED',
      inputPriceMicrosPerM: '3000000',
    });
    expect(fixedMissing.statusCode).toBe(400);

    const fixed = await call('POST', '/internal/admin/models', {
      ...modelPayload(provider.id),
      priceMode: 'FIXED',
      inputPriceMicrosPerM: '3000000',
      outputPriceMicrosPerM: '9000000',
    });
    expect(fixed.json().pricing).toMatchObject({ inputPerM: '3000000', outputPerM: '9000000' });
    const id = fixed.json().id;

    const dup = await call('POST', '/internal/admin/models', modelPayload(provider.id));
    expect(dup.statusCode).toBe(409);

    const self = await call('PATCH', `/internal/admin/models/${id}`, { fallbackModelIds: [id] });
    expect(self.statusCode).toBe(400);

    const providerDelete = await call('DELETE', `/internal/admin/providers/${provider.id}`);
    expect(providerDelete.statusCode).toBe(409);

    await ctx.prisma.usageLog.create({
      data: {
        requestId: 'r1',
        orgId: 'o',
        projectId: 'p',
        modelId: id,
        providerId: provider.id,
        status: 'SUCCESS',
      },
    });
    expect((await call('DELETE', `/internal/admin/models/${id}`)).statusCode).toBe(409);
  });

  it('is only available to super admins', async () => {
    const user = await createUserSession(ctx.app, 'cliente@example.com');
    for (const url of [
      '/internal/admin/providers',
      '/internal/admin/models',
      '/internal/admin/settings',
    ]) {
      expect((await call('GET', url, undefined, user)).statusCode).toBe(403);
    }
    expect((await call('PUT', '/internal/admin/settings', {}, user)).statusCode).toBe(403);
  });
});
