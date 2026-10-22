import { prisma } from '@fusai/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { APP_URL, createTestApp, createUserSession, resetDb } from '../../../test/helpers';

describe('admin readiness and provider health (O-10/O-11)', () => {
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
    await ctx.redis.flushdb();
    admin = await createUserSession(ctx.app, 'admin@example.com', 'SUPER_ADMIN');
  });

  const get = (url: string, cookie = admin) =>
    ctx.app.inject({ method: 'GET', url, headers: { cookie, origin: APP_URL } });
  const checks = async () =>
    Object.fromEntries(
      (await get('/internal/admin/readiness'))
        .json()
        .checks.map((c: { id: string; ok: boolean }) => [c.id, c.ok]),
    );

  async function seedProvider(apiKeyEnc = 'enc') {
    const provider = await prisma.provider.create({
      data: { slug: 'p1', name: 'P1', baseUrl: 'http://x', apiKeyEnc, status: 'ACTIVE' },
    });
    const model = await prisma.model.create({
      data: {
        slug: 'fuse/x',
        displayName: 'X',
        providerId: provider.id,
        upstreamModel: 'x',
        contextWindow: 1000,
        inputCostUsdPerM: '1',
        outputCostUsdPerM: '2',
        active: true,
      },
    });
    return { provider, model };
  }

  it('lists what is missing before selling, and turns ready when everything is set', async () => {
    expect(await checks()).toEqual({
      provider: false,
      model: false,
      asaas: true, // test env has a sandbox key
      packages: false,
      rate: false,
    });

    await seedProvider();
    await prisma.creditPackage.create({
      data: { name: 'Básico', priceCents: 1000, creditMicros: 10_000_000n },
    });
    await prisma.setting.create({ data: { key: 'usd_brl_rate', value: '5.50' } });
    const res = await get('/internal/admin/readiness');
    expect(res.json().ready).toBe(true);

    await prisma.setting.update({
      where: { key: 'usd_brl_rate' },
      data: { updatedAt: new Date(Date.now() - 8 * 86_400_000) },
    });
    expect((await checks()).rate).toBe(false);
  });

  it('does not count a provider without key or its models', async () => {
    await seedProvider('');
    expect(await checks()).toMatchObject({ provider: false, model: false });
  });

  it('reports 24 h error rate, p95 latency and the circuit breaker per provider', async () => {
    const { provider, model } = await seedProvider();
    const org = await prisma.organization.create({ data: { name: 'O', slug: 'o' } });
    const project = await prisma.project.create({
      data: { orgId: org.id, name: 'P', slug: 'p' },
    });
    const log = (status: 'SUCCESS' | 'UPSTREAM_ERROR', latencyMs: number, ageMs = 0) =>
      prisma.usageLog.create({
        data: {
          requestId: `r-${Math.random()}`,
          orgId: org.id,
          projectId: project.id,
          modelId: model.id,
          providerId: provider.id,
          status,
          latencyMs,
          createdAt: new Date(Date.now() - ageMs),
        },
      });
    for (let i = 1; i <= 20; i++) await log('SUCCESS', i * 100);
    await log('UPSTREAM_ERROR', 50);
    await log('UPSTREAM_ERROR', 50, 25 * 3600_000); // older than 24 h: ignored
    await ctx.redis.set(`cb:open:${provider.id}`, '1', 'PX', 30_000);

    const res = await get('/internal/admin/providers/health');
    expect(res.statusCode).toBe(200);
    expect(res.json().providers).toEqual([
      {
        providerId: provider.id,
        requests: 21,
        errors: 1,
        errorPct: '4.8',
        p95LatencyMs: 1905,
        circuitOpen: true,
      },
    ]);
  });

  it('is only for super admins', async () => {
    const user = await createUserSession(ctx.app, 'dono@example.com');
    expect((await get('/internal/admin/readiness', user)).statusCode).toBe(403);
    expect((await get('/internal/admin/providers/health', user)).statusCode).toBe(403);
  });
});
