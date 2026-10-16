import { createHmac } from 'node:crypto';
import { createServer, type IncomingHttpHeaders } from 'node:http';
import type { AddressInfo } from 'node:net';
import { prisma } from '@fusai/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, resetDb } from '../../../test/helpers';
import { loadEnv, testEnv } from '../../lib/env';
import { createMailer, createVeloMailMailer, MailerError } from '../../lib/mailer';

const SECRET = 'whsec_velomail_test_123';
const sign = (body: string, secret = SECRET) =>
  `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;

describe('VeloMail mailer', () => {
  const calls: { headers: IncomingHttpHeaders; body: Record<string, unknown> }[] = [];
  const replies: { status: number; body: unknown }[] = [];
  let server: ReturnType<typeof createServer>;
  let base: string;

  beforeAll(async () => {
    server = createServer((req, res) => {
      let raw = '';
      req.on('data', (c) => {
        raw += c;
      });
      req.on('end', () => {
        calls.push({ headers: req.headers, body: JSON.parse(raw) });
        const next = replies.shift() ?? {
          status: 200,
          body: { message_id: '<uz-1@velomail.com.br>' },
        };
        res
          .writeHead(next.status, { 'content-type': 'application/json' })
          .end(JSON.stringify(next.body));
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));
  beforeEach(() => {
    calls.length = 0;
    replies.length = 0;
  });

  const mailer = () =>
    createVeloMailMailer(
      { VELOMAIL_API_URL: base, EMAIL_FROM: 'fusai <nao-responda@fusai.com.br>' },
      're_test_key',
    );
  const email = { to: 'ana@exemplo.com', subject: 'Oi', html: '<p>Oi</p>', text: 'Oi' };

  it('sends to /emails/send with the re_ key in x-api-key', async () => {
    await mailer().send(email);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.headers['x-api-key']).toBe('re_test_key');
    expect(calls[0]?.body).toEqual({ from: 'fusai <nao-responda@fusai.com.br>', ...email });
  });

  it('retries 429 respecting retryAfter, then succeeds', async () => {
    replies.push({
      status: 429,
      body: { error: 'limite', code: 'RATE_LIMIT_EXCEEDED', retryAfter: 0.05 },
    });
    await mailer().send(email);
    expect(calls).toHaveLength(2);
  });

  it('throws MailerError with the VeloMail code (no retry on 4xx)', async () => {
    replies.push({
      status: 403,
      body: { error: 'Dominio nao verificado', code: 'DOMAIN_NOT_VERIFIED' },
    });
    const err = await mailer()
      .send(email)
      .catch((e) => e);
    expect(err).toBeInstanceOf(MailerError);
    expect(err).toMatchObject({ status: 403, code: 'DOMAIN_NOT_VERIFIED' });
    expect(calls).toHaveLength(1);
  });

  it('uses VeloMail only with a re_ key and refuses the uai_ agent key', () => {
    expect(() => loadEnv({ ...process.env, ...envBase(), VELOMAIL_API_KEY: 'uai_agent' })).toThrow(
      /re_/,
    );
    expect(createMailer(testEnv())).toBeDefined(); // no key -> SMTP (dev)
  });
});

function envBase() {
  return {
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://localhost/unused',
    BETTER_AUTH_SECRET: 'test-secret-test-secret-test-secret',
    ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
    KEY_PEPPER: 'test-pepper-123',
    SESSION_TOKEN_SECRET: 'test-session-secret-123',
    ASAAS_WEBHOOK_TOKEN: 'test-webhook-token-123',
  };
}

describe('VeloMail webhook', () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;

  beforeAll(async () => {
    ctx = await createTestApp({ env: { VELOMAIL_WEBHOOK_SECRET: SECRET } });
  });
  afterAll(async () => {
    await ctx.app.close();
  });
  beforeEach(async () => {
    await resetDb();
  });

  // Exact bytes matter: spaces and key order are part of the signed body.
  const body = JSON.stringify(
    {
      event: 'email.delivered',
      timestamp: '2026-10-16T12:00:00.000Z',
      webhook_id: '18',
      data: { email_id: 152, message_id: '<uz-1@velomail.com.br>', status: 'delivered' },
    },
    null,
    2,
  );
  const post = (payload: string, signature?: string) =>
    ctx.app.inject({
      method: 'POST',
      url: '/webhooks/velomail',
      payload,
      headers: {
        'content-type': 'application/json',
        ...(signature ? { 'x-webhook-signature': signature } : {}),
      },
    });

  it('accepts a valid signature over the raw body and stores the event once', async () => {
    const first = await post(body, sign(body));
    expect(first.statusCode).toBe(200);
    expect(first.json()).toEqual({ received: true });
    const retry = await post(body, sign(body));
    expect(retry.json()).toEqual({ received: true, duplicate: true });
    const rows = await prisma.inboundWebhookEvent.findMany({ where: { provider: 'velomail' } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ type: 'email.delivered' });
    expect(rows[0]?.processedAt).not.toBeNull();
  });

  it('rejects missing, wrong-secret and tampered signatures', async () => {
    expect((await post(body)).statusCode).toBe(401);
    expect((await post(body, sign(body, 'outro-segredo'))).statusCode).toBe(401);
    // Re-serialized body (same JSON, different bytes) must not pass.
    expect((await post(JSON.stringify(JSON.parse(body)), sign(body))).statusCode).toBe(401);
    expect(await prisma.inboundWebhookEvent.count()).toBe(0);
  });

  it('rejects malformed events with 400', async () => {
    const bad = JSON.stringify({ hello: 'world' });
    expect((await post(bad, sign(bad))).statusCode).toBe(400);
  });

  it('answers 503 when the secret is not configured', async () => {
    const noSecret = await createTestApp();
    const res = await noSecret.app.inject({
      method: 'POST',
      url: '/webhooks/velomail',
      payload: body,
      headers: { 'content-type': 'application/json', 'x-webhook-signature': sign(body) },
    });
    expect(res.statusCode).toBe(503);
    await noSecret.app.close();
  });

  it('keeps the normal JSON parser for the other routes', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/webhooks/asaas',
      payload: { id: 'evt_1' },
      headers: { 'asaas-access-token': 'errado' },
    });
    expect(res.statusCode).toBe(401); // parsed as JSON, rejected by token — not a 400/415
  });
});
