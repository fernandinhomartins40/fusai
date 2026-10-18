import { prisma } from '@fusai/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { startFakeAsaas } from '../../../test/fake-asaas';
import { setupGateway } from '../../../test/gateway-fixtures';
import { createFundedOrg, createTestApp, resetDb } from '../../../test/helpers';
import { generateApiKey, hashApiKey, keyDisplayPrefix } from '../api-keys/keys';
import { processWebhookEvent } from '../payments/service';

describe('organization top-ups from the customer app (/v1/topups)', () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let asaas: Awaited<ReturnType<typeof startFakeAsaas>>;
  let g: Awaited<ReturnType<typeof setupGateway>>;

  beforeAll(async () => {
    asaas = await startFakeAsaas();
    ctx = await createTestApp({ env: { ASAAS_API_URL: asaas.baseUrl } });
  });
  afterAll(async () => {
    await ctx.app.close();
    await asaas.close();
  });
  beforeEach(async () => {
    await resetDb();
    ctx.app.caches.invalidate();
    ctx.jobs.jobs.length = 0;
    g = await setupGateway(ctx.env, 'http://127.0.0.1:9', { balanceMicros: 1_000_000n });
    await prisma.organization.update({
      where: { id: g.org.id },
      data: { document: '11222333000181', name: 'Minha Empresa' },
    });
  });

  const v1 = (
    method: 'GET' | 'POST',
    url: string,
    opts: { payload?: object; headers?: Record<string, string>; key?: string } = {},
  ) =>
    ctx.app.inject({
      method,
      url: `/v1${url}`,
      payload: opts.payload,
      headers: { authorization: `Bearer ${opts.key ?? g.plain}`, ...opts.headers },
    });

  async function processQueued() {
    for (const job of ctx.jobs.jobs.splice(0)) {
      if (job.name === 'process-webhook')
        await processWebhookEvent(prisma, ctx.provider, String(job.data.eventId));
    }
  }

  it('lists options, creates a Pix top-up and credits the organization when paid', async () => {
    const options = await v1('GET', '/topup-options');
    expect(options.json()).toMatchObject({
      object: 'topup_options',
      available: true,
      minAmountCents: 500,
    });

    expect((await v1('POST', '/topups', { payload: { amountCents: 499 } })).statusCode).toBe(400);
    expect((await v1('POST', '/topups', { payload: {} })).statusCode).toBe(400);

    const created = await v1('POST', '/topups', {
      payload: { amountCents: 5000, returnUrl: 'https://app.cliente.com.br/admin/creditos' },
      headers: { 'idempotency-key': 'recarga-1' },
    });
    expect(created.statusCode).toBe(201);
    const topup = created.json();
    expect(topup).toMatchObject({ object: 'topup', status: 'PENDING', amountCents: 5000 });
    expect(topup.copyPaste).toBeTruthy();
    expect(topup.hostedUrl).toMatch(/\/pay\/chk_/);

    // Same Idempotency-Key = same top-up (double click).
    const again = await v1('POST', '/topups', {
      payload: { amountCents: 5000 },
      headers: { 'idempotency-key': 'recarga-1' },
    });
    expect(again.json().checkoutId).toBe(topup.checkoutId);

    // The hosted page works for top-ups too (the payer is paying fusai).
    const hosted = await ctx.app.inject({
      method: 'GET',
      url: `/public/checkout/${topup.checkoutId}`,
    });
    expect(hosted.json()).toMatchObject({
      merchantName: 'fusai',
      status: 'PENDING',
      returnUrl: 'https://app.cliente.com.br/admin/creditos',
    });

    const payment = await prisma.payment.findUniqueOrThrow({
      where: { publicId: topup.checkoutId },
    });
    asaas.pay(payment.providerPaymentId as string);
    await ctx.app.inject({
      method: 'POST',
      url: '/webhooks/asaas',
      payload: asaas.webhookBody('PAYMENT_RECEIVED', payment.providerPaymentId as string),
      headers: { 'asaas-access-token': ctx.env.ASAAS_WEBHOOK_TOKEN },
    });
    await processQueued();

    expect((await v1('GET', `/topups/${topup.checkoutId}`)).json()).toMatchObject({
      status: 'RECEIVED',
      copyPaste: null,
    });
    expect((await v1('GET', '/balance')).json()).toMatchObject({
      owner: 'organization',
      available_micros: '51000000',
    });
    const list = (await v1('GET', '/topups')).json();
    expect(list.data).toHaveLength(1);
    expect(list.data[0].qrBase64).toBeUndefined();
  });

  it('is for the organization only: secret key, no end user, own organization', async () => {
    const withUser = await v1('POST', '/topups', {
      payload: { amountCents: 5000 },
      headers: { 'x-fuse-user': 'alguem' },
    });
    expect(withUser.statusCode).toBe(404); // unknown end user is refused before anything
    const { org: otherOrg } = await createFundedOrg({});
    const otherProject = await prisma.project.create({
      data: { orgId: otherOrg.id, name: 'Outro', slug: 'outro' },
    });
    const otherKey = generateApiKey('LIVE');
    await prisma.apiKey.create({
      data: {
        projectId: otherProject.id,
        name: 'outra',
        prefix: keyDisplayPrefix(otherKey),
        hash: hashApiKey(otherKey, ctx.env.KEY_PEPPER),
        scopes: ['chat', 'billing:read', 'checkout'],
        createdById: 'test',
      },
    });
    const created = (await v1('POST', '/topups', { payload: { amountCents: 5000 } })).json();
    expect((await v1('GET', `/topups/${created.checkoutId}`, { key: otherKey })).statusCode).toBe(
      404,
    );
  });

  it('needs the checkout scope and a CPF/CNPJ on the organization', async () => {
    await prisma.organization.update({ where: { id: g.org.id }, data: { document: null } });
    expect((await v1('GET', '/topup-options')).json()).toMatchObject({
      available: false,
      hasDocument: false,
    });
    const res = await v1('POST', '/topups', { payload: { amountCents: 5000 } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('document_required');

    await prisma.apiKey.update({ where: { id: g.key.id }, data: { scopes: ['chat'] } });
    expect((await v1('GET', '/topup-options')).statusCode).toBe(403);
  });
});
