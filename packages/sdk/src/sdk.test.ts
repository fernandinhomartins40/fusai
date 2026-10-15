import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { FuseAI, FuseAIError } from './client';
import { formatMicros } from './format';
import { verifyWebhook } from './server';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('FuseAI client', () => {
  it('renews a session token once on 401', async () => {
    const seen: string[] = [];
    let issued = 0;
    const fuse = new FuseAI({
      baseUrl: 'https://api.test/v1',
      sessionToken: async () => `fai_st_${++issued}`,
      fetch: async (_url, init) => {
        const auth = new Headers(init?.headers).get('authorization') ?? '';
        seen.push(auth);
        return auth.endsWith('_1')
          ? json(401, { error: { message: 'expirado', code: 'invalid_api_key' } })
          : json(200, { object: 'balance', available_micros: '1500000' });
      },
    });
    const balance = await fuse.balance();
    expect(balance.available_micros).toBe('1500000');
    expect(seen).toEqual(['Bearer fai_st_1', 'Bearer fai_st_2']);
  });

  it('shares one token request between concurrent calls', async () => {
    let issued = 0;
    const fuse = new FuseAI({
      sessionToken: async () => {
        await new Promise((r) => setTimeout(r, 10));
        return `fai_st_${++issued}`;
      },
      fetch: async () => json(200, { object: 'balance', data: [] }),
    });
    await Promise.all([fuse.balance(), fuse.packages(), fuse.balance()]);
    expect(issued).toBe(1);
  });

  it('throws FuseAIError with the API code', async () => {
    const fuse = new FuseAI({
      apiKey: 'fai_live_x',
      fetch: async () =>
        json(402, {
          error: {
            message: 'Saldo insuficiente',
            code: 'insufficient_funds',
            type: 'insufficient_quota',
          },
        }),
    });
    const err = await fuse.balance().catch((e) => e);
    expect(err).toBeInstanceOf(FuseAIError);
    expect(err).toMatchObject({ status: 402, code: 'insufficient_funds' });
  });

  it('parses a streamed completion', async () => {
    const sse =
      'data: {"id":"c","choices":[{"index":0,"delta":{"content":"Olá"}}]}\n\n' +
      'data: {"id":"c","choices":[{"index":0,"delta":{"content":"!"}}]}\n\ndata: [DONE]\n\n';
    const fuse = new FuseAI({ apiKey: 'k', fetch: async () => new Response(sse) });
    let text = '';
    for await (const chunk of fuse.chat.completions.stream({ model: 'm', messages: [] })) {
      text += chunk.choices[0]?.delta.content ?? '';
    }
    expect(text).toBe('Olá!');
  });

  it('formats micros', () => {
    expect(formatMicros('1234567890')).toBe('R$ 1.234,56');
    expect(formatMicros(-2_500_000n)).toBe('-R$ 2,50');
  });
});

describe('verifyWebhook', () => {
  const secret = 'whsec_abc';
  const body = JSON.stringify({ id: 'evt_1', type: 'test.ping', created: 'x', data: {} });
  const sign = (t: number, b = body) =>
    `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${b}`).digest('hex')}`;
  const now = 1_800_000_000_000;
  const t = now / 1000;

  it('accepts a valid signature and returns the event', async () => {
    expect(await verifyWebhook(secret, sign(t), body, { now })).toMatchObject({ id: 'evt_1' });
  });
  it('rejects tampered bodies, wrong secrets and old timestamps', async () => {
    expect(await verifyWebhook(secret, sign(t), `${body} `, { now })).toBeNull();
    expect(await verifyWebhook('other', sign(t), body, { now })).toBeNull();
    expect(await verifyWebhook(secret, sign(t - 301), body, { now })).toBeNull();
    expect(await verifyWebhook(secret, undefined, body, { now })).toBeNull();
  });
});
