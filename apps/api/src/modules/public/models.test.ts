import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupGateway } from '../../../test/gateway-fixtures';
import { createTestApp, resetDb } from '../../../test/helpers';

describe('GET /public/models', () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;

  beforeAll(async () => {
    await resetDb();
    ctx = await createTestApp();
    await setupGateway(ctx.env, 'http://127.0.0.1:9');
    // One model hidden from the landing, one inactive.
    await ctx.prisma.model.update({ where: { slug: 'fuse/slow' }, data: { public: false } });
    await ctx.prisma.model.update({ where: { slug: 'fuse/bad' }, data: { active: false } });
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  it('lists active public models with list prices and no cost data, without a key', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/public/models' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('public, max-age=60');
    const { data } = res.json() as { data: Record<string, unknown>[] };
    const ids = data.map((m) => m.id);
    expect(ids).toContain('fuse/echo');
    expect(ids).not.toContain('fuse/slow');
    expect(ids).not.toContain('fuse/bad');
    expect(ids).not.toContain('fuse/auto');
    // Default settings: rate 5.50 × markup 4 → input R$ 5,50/1M, output R$ 22,00/1M.
    const echo = data.find((m) => m.id === 'fuse/echo');
    expect(echo?.pricing).toMatchObject({
      currency: 'BRL',
      input: '5.500000',
      output: '22.000000',
    });
    expect(echo?.provider).toBe('Main');
    expect(res.json().topup).toEqual({ min_cents: 500, fee_pct: '0' });
    const raw = res.body.toLowerCase();
    for (const secret of ['cost', 'markup', 'apikey', 'upstream', 'providerid', 'fake-provider']) {
      expect(raw).not.toContain(secret);
    }
  });

  it('rate limits by IP', async () => {
    let last = 0;
    for (let i = 0; i < 61; i++) {
      const res = await ctx.app.inject({
        method: 'GET',
        url: '/public/models',
        remoteAddress: '203.0.113.9',
      });
      last = res.statusCode;
    }
    expect(last).toBe(429);
  });
});
