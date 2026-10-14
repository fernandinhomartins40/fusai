import { prisma } from '@fuseai/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { startFakeAsaas } from '../../../test/fake-asaas';
import { APP_URL, createTestApp, createUserSession, resetDb } from '../../../test/helpers';
import {
  amountWithFee,
  applyRefund,
  expirePendingPayments,
  processPendingWebhookEvents,
  processWebhookEvent,
} from './service';

const TOKEN = 'test-webhook-token-123';

describe('Pix top-ups (Asaas)', () => {
  let asaas: Awaited<ReturnType<typeof startFakeAsaas>>;
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let owner: string;
  let orgId: string;
  let walletId: string;
  let packageId: string;

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
    asaas.requests.length = 0;
    owner = await createUserSession(ctx.app, 'dono@example.com');
    orgId = (
      await call('POST', '/internal/onboarding/organization', owner, {
        name: 'Loja Pix',
        document: '11.222.333/0001-81',
        phone: '11999990000',
      })
    ).json().id;
    walletId = (await prisma.wallet.findUniqueOrThrow({ where: { orgId } })).id;
    packageId = (
      await prisma.creditPackage.create({
        data: {
          name: 'R$ 50',
          priceCents: 5000,
          creditMicros: 50_000_000n,
          bonusMicros: 2_500_000n,
        },
      })
    ).id;
  });

  const call = (
    method: 'GET' | 'POST',
    url: string,
    cookie: string,
    payload?: object,
    headers: object = {},
  ) => ctx.app.inject({ method, url, payload, headers: { cookie, origin: APP_URL, ...headers } });

  const webhook = (body: object, token = TOKEN) =>
    ctx.app.inject({
      method: 'POST',
      url: '/webhooks/asaas',
      payload: body,
      headers: { 'asaas-access-token': token },
    });

  async function topup(payload: object = { packageId }) {
    const res = await call('POST', `/internal/organizations/${orgId}/topups`, owner, payload);
    expect(res.statusCode).toBe(201);
    return res.json() as {
      id: string;
      amountCents: number;
      pixCopyPaste: string;
      pixQrBase64: string;
      status: string;
    };
  }

  async function processQueued() {
    for (const job of ctx.jobs.jobs.splice(0)) {
      if (job.name === 'process-webhook')
        await processWebhookEvent(prisma, ctx.provider, String(job.data.eventId));
    }
  }

  const wallet = () => prisma.wallet.findUniqueOrThrow({ where: { id: walletId } });

  it('creates the Asaas customer, the Pix charge and returns the QR code', async () => {
    const p = await topup();
    expect(p).toMatchObject({ status: 'PENDING', amountCents: 5000 });
    expect(p.pixCopyPaste).toContain('br.gov.bcb.pix');
    expect(p.pixQrBase64.length).toBeGreaterThan(20);

    const createCustomer = asaas.requests.find((r) => r.path === '/customers');
    expect(createCustomer?.headers.access_token).toBe('$aact_hmlg_test');
    expect(createCustomer?.headers['user-agent']).toContain('FuseAI');
    expect(createCustomer?.body).toMatchObject({
      cpfCnpj: '11222333000181',
      notificationDisabled: true,
    });
    const charge = asaas.requests.find((r) => r.method === 'POST' && r.path === '/payments');
    expect(charge?.body).toMatchObject({ billingType: 'PIX', value: 50, externalReference: p.id });
    expect(
      (await prisma.organization.findUniqueOrThrow({ where: { id: orgId } })).asaasCustomerId,
    ).toMatch(/^cus_/);

    // A second top-up reuses the customer.
    await topup();
    expect(asaas.requests.filter((r) => r.path === '/customers')).toHaveLength(1);
  });

  it('credits exactly once even when the webhook is delivered 3 times (acceptance)', async () => {
    const p = await topup();
    const stored = await prisma.payment.findUniqueOrThrow({ where: { id: p.id } });
    asaas.pay(stored.providerPaymentId as string);
    const body = asaas.webhookBody(
      'PAYMENT_RECEIVED',
      stored.providerPaymentId as string,
      'evt_same',
    );

    for (let i = 0; i < 3; i++) {
      const res = await webhook(body);
      expect(res.statusCode).toBe(200);
    }
    expect(await prisma.inboundWebhookEvent.count()).toBe(1);
    await processQueued();
    // Even reprocessing everything again changes nothing.
    await processWebhookEvent(
      prisma,
      ctx.provider,
      (await prisma.inboundWebhookEvent.findFirstOrThrow()).id,
    );

    const w = await wallet();
    expect(w.balanceMicros).toBe(52_500_000n); // R$ 50 + 5% bonus
    const entries = await prisma.ledgerEntry.findMany({
      where: { walletId, referenceId: p.id },
      orderBy: { type: 'asc' },
    });
    expect(entries.map((e) => [e.type, e.amountMicros])).toEqual([
      ['PURCHASE', 50_000_000n],
      ['BONUS', 2_500_000n],
    ]);
    const after = (await call('GET', `/internal/payments/${p.id}`, owner)).json();
    expect(after).toMatchObject({ status: 'RECEIVED', pixCopyPaste: null });
    expect(after.creditedAt).toBeTruthy();
  });

  it('credits once when different events for the same payment are processed concurrently', async () => {
    const p = await topup();
    const providerId = (await prisma.payment.findUniqueOrThrow({ where: { id: p.id } }))
      .providerPaymentId as string;
    asaas.pay(providerId);
    await webhook(asaas.webhookBody('PAYMENT_CONFIRMED', providerId));
    await webhook(asaas.webhookBody('PAYMENT_RECEIVED', providerId));
    await webhook(asaas.webhookBody('PAYMENT_RECEIVED', providerId));
    const ids = (await prisma.inboundWebhookEvent.findMany()).map((e) => e.id);
    expect(ids).toHaveLength(3);
    await Promise.all(
      [...ids, ...ids].map((id) => processWebhookEvent(prisma, ctx.provider, id).catch(() => {})),
    );
    expect((await wallet()).balanceMicros).toBe(52_500_000n);
    expect(await prisma.ledgerEntry.count({ where: { referenceId: p.id } })).toBe(2);
  });

  it('rejects webhooks with a wrong token and stores nothing', async () => {
    const res = await webhook(
      { id: 'evt_x', event: 'PAYMENT_RECEIVED', payment: { id: 'pay_x' } },
      'wrong-token-1234',
    );
    expect(res.statusCode).toBe(401);
    const missing = await ctx.app.inject({ method: 'POST', url: '/webhooks/asaas', payload: {} });
    expect(missing.statusCode).toBe(401);
    expect(await prisma.inboundWebhookEvent.count()).toBe(0);
  });

  it('never credits on the webhook body alone: the PSP must confirm status and value', async () => {
    const p = await topup();
    const providerId = (await prisma.payment.findUniqueOrThrow({ where: { id: p.id } }))
      .providerPaymentId as string;
    // Not paid at Asaas yet (a forged or premature event).
    await webhook(asaas.webhookBody('PAYMENT_RECEIVED', providerId));
    await processQueued();
    expect((await wallet()).balanceMicros).toBe(0n);
    expect((await prisma.inboundWebhookEvent.findFirstOrThrow()).error).toBe('not_paid:PENDING');

    // Paid, but with a different value than we charged.
    const fake = asaas.payments.get(providerId);
    if (fake) {
      fake.status = 'RECEIVED';
      fake.value = 1;
    }
    await webhook(asaas.webhookBody('PAYMENT_RECEIVED', providerId));
    await processQueued();
    expect((await wallet()).balanceMicros).toBe(0n);
    expect(
      (await prisma.inboundWebhookEvent.findFirstOrThrow({ orderBy: { createdAt: 'desc' } })).error,
    ).toBe('amount_mismatch:100');
  });

  it('processes events left behind by the queue (sweep)', async () => {
    const p = await topup();
    const providerId = (await prisma.payment.findUniqueOrThrow({ where: { id: p.id } }))
      .providerPaymentId as string;
    asaas.pay(providerId);
    await webhook(asaas.webhookBody('PAYMENT_RECEIVED', providerId));
    ctx.jobs.jobs.length = 0; // pretend the enqueue was lost
    expect(await processPendingWebhookEvents(prisma, ctx.provider)).toBe(1);
    expect((await wallet()).balanceMicros).toBe(52_500_000n);
  });

  it('expires unpaid charges, cancels them at Asaas, and still credits a late payment', async () => {
    const p = await topup({ amountCents: 2000 });
    const stored = await prisma.payment.update({
      where: { id: p.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    expect(await expirePendingPayments(prisma, ctx.provider)).toBe(1);
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: p.id } })).status).toBe(
      'EXPIRED',
    );
    expect(asaas.requests.some((r) => r.method === 'DELETE')).toBe(true);

    // A payment that was paid just before the deadline is credited, not expired.
    const q = await topup({ amountCents: 3000 });
    const qp = await prisma.payment.update({
      where: { id: q.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    asaas.pay(qp.providerPaymentId as string);
    expect(await expirePendingPayments(prisma, ctx.provider)).toBe(0);
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: q.id } })).status).toBe(
      'RECEIVED',
    );

    // A charge expired here but still alive at Asaas (the DELETE failed) gets paid: the money
    // came in, so it is credited regardless of our local EXPIRED status.
    const fake = asaas.payments.get(stored.providerPaymentId as string);
    if (fake) {
      fake.deleted = false;
      fake.status = 'RECEIVED';
    }
    await webhook(asaas.webhookBody('PAYMENT_RECEIVED', stored.providerPaymentId as string));
    await processQueued();
    expect((await wallet()).balanceMicros).toBe(50_000_000n); // R$ 20 + R$ 30
  });

  it('refunds: admin requests it at Asaas, the webhook debits the wallet once', async () => {
    const p = await topup();
    const providerId = (await prisma.payment.findUniqueOrThrow({ where: { id: p.id } }))
      .providerPaymentId as string;
    asaas.pay(providerId);
    await webhook(asaas.webhookBody('PAYMENT_RECEIVED', providerId));
    await processQueued();

    const admin = await createUserSession(ctx.app, 'admin@example.com', 'SUPER_ADMIN');
    const req = await call('POST', `/internal/admin/payments/${p.id}/refund`, admin);
    expect(req.statusCode).toBe(200);
    expect(asaas.payments.get(providerId)?.status).toBe('REFUNDED');

    const refund = asaas.webhookBody('PAYMENT_REFUNDED', providerId);
    await webhook(refund);
    await webhook(refund);
    await processQueued();
    expect(await applyRefund(prisma, p.id)).toBe(false); // already applied
    const w = await wallet();
    expect(w.balanceMicros).toBe(0n);
    expect(await prisma.ledgerEntry.count({ where: { type: 'REFUND', referenceId: p.id } })).toBe(
      1,
    );
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: p.id } })).status).toBe(
      'REFUNDED',
    );
    expect((await call('POST', `/internal/admin/payments/${p.id}/refund`, admin)).statusCode).toBe(
      409,
    );
  });

  it('validates amounts, applies the top-up fee and honours the Idempotency-Key', async () => {
    expect(
      (await call('POST', `/internal/organizations/${orgId}/topups`, owner, { amountCents: 500 }))
        .statusCode,
    ).toBe(400);
    expect(
      (await call('POST', `/internal/organizations/${orgId}/topups`, owner, {})).statusCode,
    ).toBe(400);
    expect(
      (
        await call('POST', `/internal/organizations/${orgId}/topups`, owner, {
          amountCents: 2000,
          packageId,
        })
      ).statusCode,
    ).toBe(400);

    await prisma.setting.upsert({
      where: { key: 'topup_fee_pct' },
      update: { value: '2.5' },
      create: { key: 'topup_fee_pct', value: '2.5' },
    });
    ctx.app.caches.invalidate();
    const withFee = await topup({ amountCents: 2001 });
    expect(withFee.amountCents).toBe(2052); // 2001 + ceil(50.025) = 2001 + 51
    expect(amountWithFee(2000, '0')).toEqual({ amountCents: 2000, feeCents: 0 });

    const headers = { 'idempotency-key': 'clique-duplo-1' };
    const a = await call(
      'POST',
      `/internal/organizations/${orgId}/topups`,
      owner,
      { amountCents: 2000 },
      headers,
    );
    const b = await call(
      'POST',
      `/internal/organizations/${orgId}/topups`,
      owner,
      { amountCents: 2000 },
      headers,
    );
    expect(a.json().id).toBe(b.json().id);
  });

  it('reports PSP failures as 502 and marks the payment FAILED', async () => {
    asaas.failNext.createPayment = true;
    const res = await call('POST', `/internal/organizations/${orgId}/topups`, owner, { packageId });
    expect(res.statusCode).toBe(502);
    expect((await prisma.payment.findFirstOrThrow()).status).toBe('FAILED');
  });

  it('only owners, admins and billing members can top up; history is private', async () => {
    const options = (
      await call('GET', `/internal/organizations/${orgId}/topup-options`, owner)
    ).json();
    expect(options).toMatchObject({ canTopup: true, hasDocument: true, minTopupCents: 1000 });
    expect(options.packages).toHaveLength(1);

    await prisma.membership.updateMany({ where: { orgId }, data: { role: 'DEVELOPER' } });
    expect(
      (await call('POST', `/internal/organizations/${orgId}/topups`, owner, { packageId }))
        .statusCode,
    ).toBe(403);

    const stranger = await createUserSession(ctx.app, 'outro@example.com');
    expect(
      (await call('GET', `/internal/organizations/${orgId}/payments`, stranger)).statusCode,
    ).toBe(404);
  });
});
