import { prisma } from '@fusai/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { startFakeLlm } from '../../../test/fake-llm';
import { FAKE_PROVIDER_KEY, setupGateway } from '../../../test/gateway-fixtures';
import { createTestApp, resetDb } from '../../../test/helpers';

describe('fuse/auto: always the cheapest model (D-126)', () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let fake: Awaited<ReturnType<typeof startFakeLlm>>;

  beforeAll(async () => {
    fake = await startFakeLlm(FAKE_PROVIDER_KEY);
    ctx = await createTestApp();
  });
  afterAll(async () => {
    await ctx.app.close();
    await fake.close();
  });
  beforeEach(async () => {
    await resetDb();
    ctx.app.caches.invalidate();
    fake.requests.length = 0;
  });

  const chat = (key: string, body: object) =>
    ctx.app.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: { authorization: `Bearer ${key}` },
      payload: { messages: [{ role: 'user', content: 'Oi' }], ...body },
    });

  it('lists fuse/auto first and the models cheapest first', async () => {
    const g = await setupGateway(ctx.env, fake.baseUrl, {
      allowedSlugs: ['fuse/pricey', 'fuse/echo'],
    });
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/v1/models',
      headers: { authorization: `Bearer ${g.plain}` },
    });
    const ids = res.json().data.map((m: { id: string }) => m.id);
    expect(ids).toEqual(['fuse/auto', 'fuse/echo', 'fuse/pricey']);
    expect(res.json().data[0].pricing).toEqual(res.json().data[1].pricing);
  });

  it('routes to the cheapest model, and to the cheapest that supports tools when needed', async () => {
    const g = await setupGateway(ctx.env, fake.baseUrl, {
      allowedSlugs: ['fuse/pricey', 'fuse/echo'],
    });
    const plain = await chat(g.plain, { model: 'fuse/auto' });
    expect(plain.statusCode).toBe(200);
    expect(plain.json().model).toBe('fuse/echo');
    const cheapId = g.modelIds.get('fuse/echo') as string;
    expect((await prisma.usageLog.findFirstOrThrow()).modelId).toBe(cheapId);

    // Only the expensive model supports tools: a request with tools goes there.
    await prisma.model.update({ where: { slug: 'fuse/pricey' }, data: { supportsTools: true } });
    ctx.app.caches.invalidate();
    const withTools = await chat(g.plain, {
      model: 'fuse/auto',
      tools: [{ type: 'function', function: { name: 'hora', parameters: { type: 'object' } } }],
    });
    expect(withTools.json().model).toBe('fuse/pricey');

    // Nothing supports images: clear 503 instead of a silent wrong model.
    const vision = await chat(g.plain, {
      model: 'fuse/auto',
      messages: [
        {
          role: 'user',
          content: [{ type: 'image_url', image_url: { url: 'https://x.test/a.png' } }],
        },
      ],
    });
    expect(vision.statusCode).toBe(503);
  });

  it('falls back to the next cheapest when the cheapest fails', async () => {
    const g = await setupGateway(ctx.env, fake.baseUrl, {
      allowedSlugs: ['fuse/fail', 'fuse/pricey'],
    });
    // fuse/fail costs the same as echo (cheaper than pricey) but its upstream returns 500.
    const res = await chat(g.plain, { model: 'fuse/auto' });
    expect(res.statusCode).toBe(200);
    expect(res.json().model).toBe('fuse/pricey');
  });
});
