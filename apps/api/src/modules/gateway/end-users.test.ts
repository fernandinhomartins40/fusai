import { createHmac } from 'node:crypto';
import { createServer, type IncomingHttpHeaders } from 'node:http';
import type { AddressInfo } from 'node:net';
import { prisma } from '@fuseai/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { startFakeAsaas } from '../../../test/fake-asaas';
import { startFakeLlm } from '../../../test/fake-llm';
import { ECHO_CHARGE, FAKE_PROVIDER_KEY, setupGateway } from '../../../test/gateway-fixtures';
import { createTestApp, createUserSession, resetDb } from '../../../test/helpers';
import { encryptSecret, parseEncryptionKey } from '../../lib/crypto';
import { issueSessionToken } from '../app-users/service';
import { processWebhookEvent } from '../payments/service';
import {
  deliverDueWebhooks,
  emitEvent,
  MAX_ATTEMPTS,
  RETRY_DELAYS_MS,
} from '../webhooks-out/service';

const CPF = '529.982.247-25';
const ORIGIN = 'https://meuapp.exemplo.com';
const messages = [{ role: 'user', content: 'Olá' }];

/** Local HTTP server standing in for the customer's webhook endpoint. */
async function startReceiver() {
  const received: { headers: IncomingHttpHeaders; body: string }[] = [];
  const state = { status: 200 };
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => {
      body += c;
    });
    req.on('end', () => {
      received.push({ headers: req.headers, body });
      res.writeHead(state.status).end('ok');
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/hooks/fuse`,
    received,
    state,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

describe('end users, session tokens and Pix checkout (Phase 7)', () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let fake: Awaited<ReturnType<typeof startFakeLlm>>;
  let asaas: Awaited<ReturnType<typeof startFakeAsaas>>;
  let receiver: Awaited<ReturnType<typeof startReceiver>>;
  let deliverOpts: { encryptionKey: Buffer; production: boolean };

  beforeAll(async () => {
    fake = await startFakeLlm(FAKE_PROVIDER_KEY);
    asaas = await startFakeAsaas();
    receiver = await startReceiver();
    ctx = await createTestApp({ env: { ASAAS_API_URL: asaas.baseUrl } });
    deliverOpts = { encryptionKey: parseEncryptionKey(ctx.env.ENCRYPTION_KEY), production: false };
  });
  afterAll(async () => {
    await ctx.app.close();
    await fake.close();
    await asaas.close();
    await receiver.close();
  });
  beforeEach(async () => {
    await resetDb();
    ctx.app.caches.invalidate();
    await ctx.redis.flushdb();
    receiver.received.length = 0;
    receiver.state.status = 200;
  });

  type Mode = 'ORG_WALLET' | 'END_USER_WALLET' | 'HYBRID';
  async function setup(billingMode: Mode = 'END_USER_WALLET', freeCreditMicros = 1_000_000n) {
    const g = await setupGateway(ctx.env, fake.baseUrl, { balanceMicros: 5_000_000n });
    await prisma.organization.update({
      where: { id: g.org.id },
      data: { document: '11222333000181' },
    });
    const project = await prisma.project.update({
      where: { id: g.project.id },
      data: { billingMode, freeCreditMicros, allowedOrigins: [ORIGIN] },
    });
    const pkg = await prisma.creditPackage.create({
      data: {
        projectId: project.id,
        name: '100 mensagens',
        priceCents: 990,
        creditMicros: 9_000_000n,
        bonusMicros: 1_000_000n,
      },
    });
    return { ...g, project, pkg };
  }

  const v1 = (
    method: 'GET' | 'POST',
    url: string,
    token: string,
    payload?: object,
    headers: Record<string, string> = {},
  ) =>
    ctx.app.inject({
      method,
      url: `/v1${url}`,
      payload,
      headers: { authorization: `Bearer ${token}`, ...headers },
    });

  async function createUser(secret: string, externalId = 'user-1', extra: object = {}) {
    const res = await v1('POST', '/app-users', secret, { externalId, ...extra });
    expect(res.statusCode).toBeLessThan(300);
    return res.json() as { id: string; externalId: string; balanceMicros: string };
  }

  async function sessionToken(secret: string, externalId = 'user-1') {
    const res = await v1('POST', `/app-users/${externalId}/session-token`, secret);
    expect(res.statusCode).toBe(200);
    return res.json().token as string;
  }

  const appUserWallet = async (appUserId: string) =>
    prisma.wallet.findUniqueOrThrow({ where: { appUserId } });

  it('upserts end users with the free credit exactly once', async () => {
    const g = await setup();
    const first = await v1('POST', '/app-users', g.plain, { externalId: 'u-42', name: 'Ana' });
    expect(first.statusCode).toBe(201);
    expect(first.json()).toMatchObject({
      externalId: 'u-42',
      name: 'Ana',
      balanceMicros: '1000000',
    });

    const again = await v1('POST', '/app-users', g.plain, { externalId: 'u-42', email: 'a@b.com' });
    expect(again.statusCode).toBe(200);
    expect(again.json()).toMatchObject({ email: 'a@b.com', balanceMicros: '1000000' });
    const got = await v1('GET', '/app-users/u-42', g.plain);
    expect(got.json().balanceMicros).toBe('1000000');
    expect(await prisma.ledgerEntry.count({ where: { referenceType: 'free_credit' } })).toBe(1);

    expect((await v1('GET', '/app-users/nobody', g.plain)).statusCode).toBe(404);
  });

  it('ORG_WALLET projects give no free credit to end users', async () => {
    const g = await setup('ORG_WALLET');
    expect((await createUser(g.plain)).balanceMicros).toBe('0');
  });

  it('session tokens: scoped, origin-checked, and charge the end user wallet', async () => {
    const g = await setup();
    const user = await createUser(g.plain);
    const token = await sessionToken(g.plain);
    expect(token.startsWith('fai_st_')).toBe(true);

    const chat = await v1(
      'POST',
      '/chat/completions',
      token,
      { model: 'fuse/echo', messages },
      { origin: ORIGIN },
    );
    expect(chat.statusCode).toBe(200);
    expect(chat.headers['access-control-allow-origin']).toBe(ORIGIN);
    expect((await appUserWallet(user.id)).balanceMicros).toBe(1_000_000n - ECHO_CHARGE);
    expect(
      (await prisma.wallet.findUniqueOrThrow({ where: { id: g.walletId } })).balanceMicros,
    ).toBe(5_000_000n);
    const log = await prisma.usageLog.findFirstOrThrow();
    expect(log).toMatchObject({ appUserId: user.id, apiKeyId: null });

    const balance = await v1('GET', '/balance', token, undefined, { origin: ORIGIN });
    expect(balance.json()).toMatchObject({
      owner: 'app_user',
      balance_micros: String(1_000_000n - ECHO_CHARGE),
    });

    // Other origins, project-wide data and secret-only routes are refused.
    const evil = await v1('GET', '/balance', token, undefined, { origin: 'https://evil.com' });
    expect(evil.statusCode).toBe(403);
    expect(evil.json().error.code).toBe('origin_not_allowed');
    expect((await v1('GET', '/usage', token)).statusCode).toBe(403);
    expect((await v1('POST', '/app-users', token, { externalId: 'x' })).statusCode).toBe(403);
    expect((await v1('POST', '/app-users/user-1/session-token', token)).statusCode).toBe(403);
  });

  it('rejects tampered, expired and foreign session tokens', async () => {
    const g = await setup();
    const user = await createUser(g.plain);
    const token = await sessionToken(g.plain);
    const tampered = `${token.slice(0, -2)}${token.endsWith('A') ? 'BB' : 'AA'}`;
    expect((await v1('GET', '/balance', tampered)).statusCode).toBe(401);

    const old = issueSessionToken(user.id, g.project.id, ctx.env.SESSION_TOKEN_SECRET, 0).token;
    expect((await v1('GET', '/balance', old)).statusCode).toBe(401);

    const otherSecret = issueSessionToken(user.id, g.project.id, 'another-secret-xyz').token;
    expect((await v1('GET', '/balance', otherSecret)).statusCode).toBe(401);
  });

  it('a secret key in a browser is refused', async () => {
    const g = await setup();
    const res = await v1('GET', '/balance', g.plain, undefined, { origin: ORIGIN });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('secret_key_in_browser');
  });

  it('END_USER_WALLET requires an end user; X-Fuse-User charges that user', async () => {
    const g = await setup();
    const user = await createUser(g.plain);
    const body = { model: 'fuse/echo', messages };

    const missing = await v1('POST', '/chat/completions', g.plain, body);
    expect(missing.statusCode).toBe(400);
    expect(missing.json().error.code).toBe('app_user_required');

    const ok = await v1('POST', '/chat/completions', g.plain, body, { 'x-fuse-user': 'user-1' });
    expect(ok.statusCode).toBe(200);
    expect((await appUserWallet(user.id)).balanceMicros).toBe(1_000_000n - ECHO_CHARGE);

    const unknown = await v1('POST', '/chat/completions', g.plain, body, { 'x-fuse-user': 'nope' });
    expect(unknown.statusCode).toBe(404);
  });

  it('END_USER_WALLET without credits answers 402; HYBRID falls back to the organization', async () => {
    const g = await setup('END_USER_WALLET', 0n);
    await createUser(g.plain);
    const body = { model: 'fuse/echo', messages };
    const res = await v1('POST', '/chat/completions', g.plain, body, { 'x-fuse-user': 'user-1' });
    expect(res.statusCode).toBe(402);

    await prisma.project.update({ where: { id: g.project.id }, data: { billingMode: 'HYBRID' } });
    const hybrid = await v1('POST', '/chat/completions', g.plain, body, {
      'x-fuse-user': 'user-1',
    });
    expect(hybrid.statusCode).toBe(200);
    expect(
      (await prisma.wallet.findUniqueOrThrow({ where: { id: g.walletId } })).balanceMicros,
    ).toBe(5_000_000n - ECHO_CHARGE);
  });

  it('end user buys a package via Pix: credit, signed webhooks, hosted checkout', async () => {
    const g = await setup();
    await prisma.project.update({
      where: { id: g.project.id },
      data: {
        webhookUrl: receiver.url,
        webhookSecret: encryptSecret('whsec_test', deliverOpts.encryptionKey),
      },
    });
    const user = await createUser(g.plain);
    const token = await sessionToken(g.plain);

    const pkgs = await v1('GET', '/packages', token, undefined, { origin: ORIGIN });
    expect(pkgs.json().data).toEqual([
      expect.objectContaining({ id: g.pkg.id, priceCents: 990, creditMicros: '9000000' }),
    ]);

    const noDoc = await v1(
      'POST',
      '/checkout/pix',
      token,
      { packageId: g.pkg.id },
      { origin: ORIGIN },
    );
    expect(noDoc.statusCode).toBe(400);
    expect(noDoc.json().error.code).toBe('document_required');

    const res = await v1(
      'POST',
      '/checkout/pix',
      token,
      { packageId: g.pkg.id, document: CPF, name: 'Ana', returnUrl: 'meuapp://ok' },
      { origin: ORIGIN },
    );
    expect(res.statusCode).toBe(201);
    const checkout = res.json();
    expect(checkout).toMatchObject({
      status: 'PENDING',
      amountCents: 990,
      creditMicros: '10000000',
      hostedUrl: `http://localhost:3000/pay/${checkout.checkoutId}`,
    });
    expect(checkout.checkoutId).toMatch(/^chk_/);
    expect(checkout.copyPaste).toContain('br.gov.bcb.pix');
    expect(asaas.customers.at(-1)).toMatchObject({ cpfCnpj: '52998224725', name: 'Ana' });

    // Hosted page data (public, by the unguessable id).
    const pub = await ctx.app.inject({
      method: 'GET',
      url: `/public/checkout/${checkout.checkoutId}`,
    });
    expect(pub.statusCode).toBe(200);
    expect(pub.json()).toMatchObject({
      status: 'PENDING',
      returnUrl: 'meuapp://ok',
      merchantName: 'App',
    });
    expect(pub.json().walletId).toBeUndefined();
    const bogus = await ctx.app.inject({
      method: 'GET',
      url: '/public/checkout/chk_aaaaaaaaaaaaaaaaaaaaaaaa',
    });
    expect(bogus.statusCode).toBe(404);

    // Paid at the PSP -> Asaas webhook -> credited to the END USER wallet.
    const payment = await prisma.payment.findUniqueOrThrow({
      where: { publicId: checkout.checkoutId },
    });
    asaas.pay(payment.providerPaymentId as string);
    const hook = await ctx.app.inject({
      method: 'POST',
      url: '/webhooks/asaas',
      payload: asaas.webhookBody('PAYMENT_RECEIVED', payment.providerPaymentId as string),
      headers: { 'asaas-access-token': ctx.env.ASAAS_WEBHOOK_TOKEN },
    });
    expect(hook.statusCode).toBe(200);
    for (const job of ctx.jobs.jobs.splice(0)) {
      if (job.name === 'process-webhook')
        await processWebhookEvent(prisma, ctx.provider, String(job.data.eventId));
    }
    expect((await appUserWallet(user.id)).balanceMicros).toBe(11_000_000n);
    expect(
      (await prisma.wallet.findUniqueOrThrow({ where: { id: g.walletId } })).balanceMicros,
    ).toBe(5_000_000n);
    const status = await v1('GET', `/checkout/${checkout.checkoutId}`, token, undefined, {
      origin: ORIGIN,
    });
    expect(status.json()).toMatchObject({ status: 'RECEIVED', copyPaste: null });

    // Outbox -> signed deliveries to the customer's endpoint.
    expect(await deliverDueWebhooks(prisma, deliverOpts)).toBe(2);
    expect(receiver.received.map((r) => r.headers['x-fuse-event']).sort()).toEqual([
      'app_user.credited',
      'payment.received',
    ]);
    const delivered = await prisma.outboundWebhook.findMany();
    expect(delivered.map((d) => d.status)).toEqual(['delivered', 'delivered']);
    const body = JSON.parse(receiver.received[0]?.body ?? '{}');
    expect(body.data).toMatchObject({
      payment: { checkoutId: checkout.checkoutId, status: 'RECEIVED', amountCents: 990 },
      appUser: { externalId: 'user-1', balanceMicros: '11000000' },
    });
  });

  it('signs webhook deliveries with HMAC and retries with backoff', async () => {
    const g = await setup();
    const owner = await ownerSession(g.org.id);
    // Setting the URL from the dashboard creates the signing secret automatically.
    const patch = await dash('PATCH', `/internal/projects/${g.project.id}`, owner, {
      webhookUrl: receiver.url,
    });
    expect(patch.json().hasWebhookSecret).toBe(true);
    const got0 = await dash('GET', `/internal/projects/${g.project.id}`, owner);
    expect(got0.json().hasWebhookSecret).toBe(true);
    const secret = (
      await dash('GET', `/internal/projects/${g.project.id}/webhook-secret`, owner)
    ).json().secret as string;

    const test = await dash('POST', `/internal/projects/${g.project.id}/webhooks/test`, owner);
    expect(test.json()).toMatchObject({ status: 'delivered', responseStatus: 200 });
    const got = receiver.received[0];
    const sig = String(got?.headers['x-fuse-signature']);
    const [, t, v1sig] = sig.match(/^t=(\d+),v1=([0-9a-f]{64})$/) ?? [];
    expect(createHmac('sha256', secret).update(`${t}.${got?.body}`).digest('hex')).toBe(v1sig);
    expect(JSON.parse(got?.body ?? '{}')).toMatchObject({
      type: 'test.ping',
      id: expect.stringMatching(/^evt_/),
    });

    // Failing endpoint: 1m, 5m, ... then failed after MAX_ATTEMPTS.
    receiver.state.status = 500;
    const user = await createUser(g.plain);
    await emitEvent(prisma, g.project.id, 'app_user.credited', { appUser: { id: user.id } });
    const hookRow = await prisma.outboundWebhook.findFirstOrThrow({
      where: { event: 'app_user.credited' },
    });
    for (let i = 1; i <= MAX_ATTEMPTS; i++) {
      const before = Date.now();
      await deliverDueWebhooks(prisma, deliverOpts);
      const row = await prisma.outboundWebhook.findUniqueOrThrow({ where: { id: hookRow.id } });
      expect(row.attempts).toBe(i);
      if (i < MAX_ATTEMPTS) {
        expect(row.status).toBe('pending');
        const delay = row.nextAttemptAt.getTime() - before;
        expect(delay).toBeGreaterThanOrEqual((RETRY_DELAYS_MS[i - 1] as number) - 1000);
        await prisma.outboundWebhook.update({
          where: { id: row.id },
          data: { nextAttemptAt: new Date() },
        });
      } else {
        expect(row).toMatchObject({ status: 'failed', responseStatus: 500, lastError: 'HTTP 500' });
      }
    }

    // Manual resend from the dashboard.
    receiver.state.status = 204;
    const resend = await dash(
      'POST',
      `/internal/projects/${g.project.id}/webhooks/${hookRow.id}/resend`,
      owner,
    );
    expect(resend.json()).toMatchObject({ status: 'delivered', responseStatus: 204 });
    const list = await dash('GET', `/internal/projects/${g.project.id}/webhooks`, owner);
    expect(list.json().deliveries.map((d: { event: string }) => d.event)).toContain(
      'app_user.credited',
    );
  });

  it('checkout validations: foreign package, unsafe return_url, ORG_WALLET', async () => {
    const g = await setup();
    await createUser(g.plain, 'user-1', { document: CPF });
    const other = await prisma.creditPackage.create({
      data: { name: 'Global', priceCents: 1000, creditMicros: 10_000_000n },
    });
    const pix = (body: object) =>
      v1('POST', '/checkout/pix', g.plain, { externalId: 'user-1', ...body });

    expect((await pix({ packageId: other.id })).statusCode).toBe(404);
    const js = await pix({ packageId: g.pkg.id, returnUrl: 'javascript:alert(1)' });
    expect(js.statusCode).toBe(400);
    expect(js.json().error.code).toBe('invalid_return_url');
    expect((await v1('POST', '/checkout/pix', g.plain, { packageId: g.pkg.id })).statusCode).toBe(
      400,
    );

    // Idempotency-Key returns the same checkout.
    const a = await v1(
      'POST',
      '/checkout/pix',
      g.plain,
      { externalId: 'user-1', packageId: g.pkg.id },
      { 'idempotency-key': 'k1' },
    );
    const b = await v1(
      'POST',
      '/checkout/pix',
      g.plain,
      { externalId: 'user-1', packageId: g.pkg.id },
      { 'idempotency-key': 'k1' },
    );
    expect(a.statusCode).toBe(201);
    expect(b.json().checkoutId).toBe(a.json().checkoutId);

    await prisma.project.update({
      where: { id: g.project.id },
      data: { billingMode: 'ORG_WALLET' },
    });
    const org = await pix({ packageId: g.pkg.id });
    expect(org.json().error.code).toBe('billing_mode_org_wallet');
  });

  it('CORS: /v1 reflects any origin without credentials; the dashboard API does not', async () => {
    const pre = await ctx.app.inject({
      method: 'OPTIONS',
      url: '/v1/chat/completions',
      headers: {
        origin: ORIGIN,
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'authorization,content-type',
      },
    });
    expect(pre.statusCode).toBe(204);
    expect(pre.headers['access-control-allow-origin']).toBe(ORIGIN);
    expect(pre.headers['access-control-allow-credentials']).toBeUndefined();

    const internal = await ctx.app.inject({
      method: 'OPTIONS',
      url: '/internal/me',
      headers: { origin: ORIGIN, 'access-control-request-method': 'GET' },
    });
    expect(internal.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('dashboard: packages CRUD, end users list and manual adjustment', async () => {
    const g = await setup();
    const owner = await ownerSession(g.org.id);
    const base = `/internal/projects/${g.project.id}`;
    const created = await dash('POST', `${base}/packages`, owner, {
      name: 'Pacote grande',
      priceCents: 4990,
      creditMicros: '50000000',
      bonusMicros: '5000000',
      highlight: true,
      active: true,
      sortOrder: 1,
    });
    expect(created.statusCode).toBe(201);
    const cheap = await dash('POST', `${base}/packages`, owner, {
      name: 'Barato',
      priceCents: 100,
      creditMicros: '1000000',
      bonusMicros: '0',
      highlight: false,
      active: true,
      sortOrder: 0,
    });
    expect(cheap.statusCode).toBe(400);
    const id = created.json().id;
    const upd = await dash('PATCH', `${base}/packages/${id}`, owner, { priceCents: 3990 });
    expect(upd.json().priceCents).toBe(3990);
    expect((await dash('GET', `${base}/packages`, owner)).json().packages).toHaveLength(2);
    expect((await dash('DELETE', `${base}/packages/${id}`, owner)).json()).toMatchObject({
      deleted: true,
    });

    const user = await createUser(g.plain, 'joao', { email: 'joao@x.com' });
    await createUser(g.plain, 'maria');
    const list = await dash('GET', `${base}/app-users?q=JOAO`, owner);
    expect(list.json()).toMatchObject({
      total: 2,
      appUsers: [expect.objectContaining({ externalId: 'joao' })],
    });

    const adj = await dash('POST', `${base}/app-users/${user.id}/adjust`, owner, {
      amountMicros: '2500000',
      description: 'Cortesia',
    });
    expect(adj.json().balanceMicros).toBe('3500000');
    const tooMuch = await dash('POST', `${base}/app-users/${user.id}/adjust`, owner, {
      amountMicros: '-9000000',
      description: 'Remoção',
    });
    expect(tooMuch.statusCode).toBe(400);
    expect((await appUserWallet(user.id)).balanceMicros).toBe(3_500_000n);
  });

  // ---- dashboard helpers ----
  async function ownerSession(orgId: string) {
    const email = `dono-${orgId}@example.com`;
    const cookie = await createUserSession(ctx.app, email);
    const u = await prisma.user.findUniqueOrThrow({ where: { email } });
    await prisma.membership.create({ data: { userId: u.id, orgId, role: 'OWNER' } });
    return cookie;
  }
  function dash(
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    url: string,
    cookie: string,
    payload?: object,
  ) {
    return ctx.app.inject({
      method,
      url,
      payload,
      headers: { cookie, origin: 'http://localhost:3000' },
    });
  }
});
