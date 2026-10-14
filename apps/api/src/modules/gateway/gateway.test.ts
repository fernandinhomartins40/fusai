import type { AddressInfo } from 'node:net';
import { prisma } from '@fuseai/db';
import OpenAI from 'openai';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { startFakeLlm } from '../../../test/fake-llm';
import { ECHO_CHARGE, FAKE_PROVIDER_KEY, setupGateway } from '../../../test/gateway-fixtures';
import { createTestApp, resetDb } from '../../../test/helpers';

const messages = [{ role: 'user' as const, content: 'Diga olá' }];
type ErrorBody = { error: { code: string; type: string; message: string } };

describe('gateway with the official OpenAI SDK', () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let fake: Awaited<ReturnType<typeof startFakeLlm>>;
  let baseURL: string;

  beforeAll(async () => {
    fake = await startFakeLlm(FAKE_PROVIDER_KEY);
    ctx = await createTestApp();
    await ctx.app.listen({ port: 0, host: '127.0.0.1' });
    baseURL = `http://127.0.0.1:${(ctx.app.server.address() as AddressInfo).port}/v1`;
  });
  afterAll(async () => {
    await ctx.app.close();
    await fake.close();
  });
  beforeEach(async () => {
    await resetDb();
    ctx.app.caches.invalidate();
    await ctx.redis.flushdb();
    fake.requests.length = 0;
    fake.aborted.length = 0;
  });

  const client = (apiKey: string) => new OpenAI({ apiKey, baseURL, maxRetries: 0 });
  const setup = (opts: Parameters<typeof setupGateway>[2] = {}) =>
    setupGateway(ctx.env, fake.baseUrl, opts);
  const wallet = (id: string) => prisma.wallet.findUniqueOrThrow({ where: { id } });
  const apiError = async (p: Promise<unknown>) => {
    try {
      await p;
    } catch (err) {
      return err as InstanceType<typeof OpenAI.APIError>;
    }
    throw new Error('expected an API error');
  };

  it('completes without streaming and debits exactly tokens × price', async () => {
    const g = await setup({ balanceMicros: 1_000_000n });
    const res = await client(g.plain).chat.completions.create({ model: 'fuse/echo', messages });

    expect(res.choices[0]?.message.content).toBe('Olá do FuseAI!');
    expect(res.model).toBe('fuse/echo');
    expect(res.id.startsWith('chatcmpl-')).toBe(true);
    expect((res as unknown as Record<string, unknown>).provider).toBeUndefined();
    expect(res.usage).toEqual({
      prompt_tokens: 12,
      completion_tokens: 8,
      total_tokens: 20,
      prompt_tokens_details: { cached_tokens: 0 },
      completion_tokens_details: { reasoning_tokens: 0 },
    });
    expect(fake.requests[0]).toMatchObject({ model: 'echo', stream: false });

    const w = await wallet(g.walletId);
    expect(ECHO_CHARGE).toBe(242n);
    expect(w.balanceMicros).toBe(1_000_000n - ECHO_CHARGE);
    expect(w.reservedMicros).toBe(0n);
    const log = await prisma.usageLog.findFirstOrThrow();
    expect(log).toMatchObject({
      status: 'SUCCESS',
      promptTokens: 12,
      completionTokens: 8,
      chargedMicros: 242n,
      costUsdMicros: 11n, // 12 × 0.25 + 8 × 1.00 micro-USD
      stream: false,
      errorCode: null,
    });
    const usage = await prisma.ledgerEntry.findFirstOrThrow({ where: { type: 'USAGE' } });
    expect(usage).toMatchObject({ amountMicros: -242n, referenceId: log.requestId });
  });

  it('streams chunk by chunk and debits the usage reported at the end', async () => {
    const g = await setup({ balanceMicros: 1_000_000n });
    const stream = await client(g.plain).chat.completions.create({
      model: 'fuse/echo',
      messages,
      stream: true,
      stream_options: { include_usage: true },
    });
    let text = '';
    let usage: unknown = null;
    const models = new Set<string>();
    for await (const chunk of stream) {
      text += chunk.choices[0]?.delta?.content ?? '';
      if (chunk.usage) usage = chunk.usage;
      models.add(chunk.model);
    }
    expect(text).toBe('Olá do FuseAI!');
    expect(usage).toMatchObject({ prompt_tokens: 12, completion_tokens: 8 });
    expect([...models]).toEqual(['fuse/echo']);
    expect(fake.requests[0]?.body.stream_options).toEqual({ include_usage: true });
    expect((await wallet(g.walletId)).balanceMicros).toBe(1_000_000n - 242n);
    expect(await prisma.usageLog.findFirstOrThrow()).toMatchObject({
      stream: true,
      chargedMicros: 242n,
    });
  });

  it('hides the usage chunk when the client did not ask for it, but still charges', async () => {
    const g = await setup({ balanceMicros: 1_000_000n });
    const stream = await client(g.plain).chat.completions.create({
      model: 'fuse/echo',
      messages,
      stream: true,
    });
    let sawUsage = false;
    for await (const chunk of stream) if (chunk.usage) sawUsage = true;
    expect(sawUsage).toBe(false);
    expect(fake.requests[0]?.body.stream_options).toEqual({ include_usage: true });
    expect((await wallet(g.walletId)).balanceMicros).toBe(1_000_000n - 242n);
  });

  it('returns 402 insufficient_funds without balance', async () => {
    const g = await setup({ balanceMicros: 0n });
    const err = await apiError(
      client(g.plain).chat.completions.create({ model: 'fuse/echo', messages }),
    );
    expect(err.status).toBe(402);
    expect(err.code).toBe('insufficient_funds');
    expect(fake.requests).toHaveLength(0);
    expect(await prisma.usageLog.findFirstOrThrow()).toMatchObject({
      status: 'INSUFFICIENT_FUNDS',
      chargedMicros: 0n,
    });
    expect(await prisma.walletHold.count()).toBe(0);
  });

  it('rejects revoked, expired and malformed keys with 401', async () => {
    const g = await setup();
    await prisma.apiKey.update({ where: { id: g.key.id }, data: { revokedAt: new Date() } });
    const revoked = await apiError(
      client(g.plain).chat.completions.create({ model: 'fuse/echo', messages }),
    );
    expect(revoked.status).toBe(401);
    expect(revoked.code).toBe('invalid_api_key');

    await prisma.apiKey.update({
      where: { id: g.key.id },
      data: { revokedAt: null, expiresAt: new Date(Date.now() - 1000) },
    });
    expect((await apiError(client(g.plain).models.list())).status).toBe(401);
    expect((await apiError(client('fai_live_nope').models.list())).status).toBe(401);
    expect((await apiError(client(`${g.plain.slice(0, -1)}X`).models.list())).status).toBe(401);
  });

  it('falls back to another provider on 5xx before the first token', async () => {
    const g = await setup({ balanceMicros: 1_000_000n });
    const res = await client(g.plain).chat.completions.create({ model: 'fuse/fail', messages });
    expect(res.model).toBe('fuse/echo-backup');
    expect(fake.requests.map((r) => r.model)).toEqual(['fail-500', 'echo']);
    const log = await prisma.usageLog.findFirstOrThrow();
    expect(log).toMatchObject({
      status: 'SUCCESS',
      modelId: g.modelIds.get('fuse/echo-backup'),
      providerId: g.providers.backup.id,
    });
  });

  it('opens the circuit after 5 failures and skips the broken provider', async () => {
    const g = await setup({ balanceMicros: 5_000_000n });
    for (let i = 0; i < 5; i++)
      await client(g.plain).chat.completions.create({ model: 'fuse/fail', messages });
    fake.requests.length = 0;
    const res = await client(g.plain).chat.completions.create({ model: 'fuse/fail', messages });
    expect(res.model).toBe('fuse/echo-backup');
    expect(fake.requests.map((r) => r.model)).toEqual(['echo']); // main provider skipped
  });

  it('passes client errors through (400) without fallback or charge', async () => {
    const g = await setup({ balanceMicros: 1_000_000n });
    const err = await apiError(
      client(g.plain).chat.completions.create({ model: 'fuse/bad', messages }),
    );
    expect(err.status).toBe(400);
    expect(err.message).toContain('invalid role');
    expect(fake.requests).toHaveLength(1);
    const w = await wallet(g.walletId);
    expect(w).toMatchObject({ balanceMicros: 1_000_000n, reservedMicros: 0n });
    expect(await prisma.usageLog.findFirstOrThrow()).toMatchObject({
      status: 'CLIENT_ERROR',
      chargedMicros: 0n,
    });
  });

  it('estimates usage when the provider does not report it', async () => {
    const g = await setup({ balanceMicros: 1_000_000n });
    await client(g.plain).chat.completions.create({ model: 'fuse/no-usage', messages });
    const log = await prisma.usageLog.findFirstOrThrow();
    expect(log.errorCode).toBe('usage_estimated');
    expect(log.completionTokens).toBeGreaterThan(0);
    expect(log.chargedMicros).toBeGreaterThan(0n);
    expect((await wallet(g.walletId)).balanceMicros).toBe(1_000_000n - log.chargedMicros);
  });

  it('aborts the upstream when the client disconnects and charges what was generated', async () => {
    const g = await setup({ balanceMicros: 5_000_000n });
    const controller = new AbortController();
    const stream = await client(g.plain).chat.completions.create(
      { model: 'fuse/slow', messages, stream: true },
      { signal: controller.signal },
    );
    let chunks = 0;
    try {
      for await (const _ of stream) {
        if (++chunks === 5) controller.abort();
      }
    } catch {}

    let log = null;
    for (let i = 0; i < 50 && !log; i++) {
      log = await prisma.usageLog.findFirst();
      if (!log) await new Promise((r) => setTimeout(r, 50));
    }
    expect(log?.status).toBe('CLIENT_ERROR');
    expect(log?.errorCode).toContain('client_disconnected');
    expect(log?.completionTokens).toBeGreaterThan(0);
    expect(log?.completionTokens).toBeLessThan(200);
    expect(fake.aborted).toContain('slow');
    const w = await wallet(g.walletId);
    expect(w.reservedMicros).toBe(0n);
    expect(w.balanceMicros).toBe(5_000_000n - (log?.chargedMicros ?? 0n));
  });

  it('enforces the per-key requests-per-minute limit', async () => {
    const g = await setup({ rpmLimit: 2 });
    await client(g.plain).chat.completions.create({ model: 'fuse/echo', messages });
    await client(g.plain).chat.completions.create({ model: 'fuse/echo', messages });
    const err = await apiError(
      client(g.plain).chat.completions.create({ model: 'fuse/echo', messages }),
    );
    expect(err.status).toBe(429);
    expect(err.code).toBe('rate_limited');
    expect(err.headers?.get('retry-after')).toBeTruthy();
  });

  it('does not debit INTERNAL organizations but logs the virtual charge', async () => {
    const g = await setup({ billingType: 'INTERNAL', balanceMicros: 0n });
    await client(g.plain).chat.completions.create({ model: 'fuse/echo', messages });
    expect((await wallet(g.walletId)).balanceMicros).toBe(0n);
    expect(await prisma.usageLog.findFirstOrThrow()).toMatchObject({
      status: 'SUCCESS',
      chargedMicros: 242n,
    });
    expect(await prisma.ledgerEntry.count({ where: { type: 'USAGE' } })).toBe(0);
  });

  it('lists allowed models with BRL pricing and enforces the allow-list', async () => {
    const g = await setup({ allowedSlugs: ['fuse/echo', 'fuse/fail'] });
    const list = await client(g.plain).models.list();
    const ids = list.data.map((m) => m.id);
    expect(ids).toEqual(['fuse/echo', 'fuse/fail']);
    expect((list.data[0] as unknown as { pricing: unknown }).pricing).toEqual({
      currency: 'BRL',
      unit: '1M tokens',
      input: '5.500000',
      cached_input: '5.500000',
      output: '22.000000',
    });
    const denied = await apiError(
      client(g.plain).chat.completions.create({ model: 'fuse/slow', messages }),
    );
    expect(denied.status).toBe(403);
    expect(denied.code).toBe('model_not_allowed');
    const missing = await apiError(
      client(g.plain).chat.completions.create({ model: 'nope', messages }),
    );
    expect(missing.status).toBe(404);
    expect(missing.code).toBe('model_not_found');
  });

  it('restricts TEST keys to cheap models', async () => {
    const g = await setup({ keyEnv: 'TEST' });
    const ids = (await client(g.plain).models.list()).data.map((m) => m.id);
    expect(ids).toContain('fuse/echo');
    expect(ids).not.toContain('fuse/pricey'); // output R$ 220/1M
    const err = await apiError(
      client(g.plain).chat.completions.create({ model: 'fuse/pricey', messages }),
    );
    expect(err.status).toBe(403);
  });

  it('stops at the monthly spend limit of the key', async () => {
    const g = await setup({ spendLimitMicros: 400n });
    const body = { model: 'fuse/echo', messages, max_tokens: 5 };
    await client(g.plain).chat.completions.create(body);
    const err = await apiError(client(g.plain).chat.completions.create(body));
    expect(err.status).toBe(402);
    expect(err.code).toBe('spend_limit_reached');
  });

  it('exposes balance and usage, guarded by scopes', async () => {
    const g = await setup({ balanceMicros: 2_000_000n });
    await client(g.plain).chat.completions.create({ model: 'fuse/echo', messages });
    const headers = { authorization: `Bearer ${g.plain}` };
    const balance = await fetch(`${baseURL}/balance`, { headers }).then((r) => r.json());
    expect(balance).toMatchObject({
      currency: 'BRL',
      balance_micros: String(2_000_000n - 242n),
      available: '1.999758',
    });
    const usage = (await fetch(`${baseURL}/usage`, { headers }).then((r) => r.json())) as {
      total: unknown;
      by_model: unknown[];
    };
    expect(usage.total).toMatchObject({
      requests: 1,
      prompt_tokens: 12,
      completion_tokens: 8,
      charged_micros: '242',
    });
    expect(usage.by_model[0]).toMatchObject({ model: 'fuse/echo', requests: 1 });

    await prisma.apiKey.update({ where: { id: g.key.id }, data: { scopes: ['chat'] } });
    const denied = await fetch(`${baseURL}/balance`, { headers });
    expect(denied.status).toBe(403);
    expect(((await denied.json()) as ErrorBody).error.code).toBe('insufficient_scope');
  });

  it('validates the request body in the OpenAI error format', async () => {
    const g = await setup();
    const res = await fetch(`${baseURL}/chat/completions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${g.plain}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'fuse/echo', messages: [] }),
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as ErrorBody).error).toMatchObject({
      type: 'invalid_request_error',
      code: 'invalid_request',
    });
  });
});
