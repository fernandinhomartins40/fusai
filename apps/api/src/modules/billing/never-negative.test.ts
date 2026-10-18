import { prisma } from '@fusai/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { startFakeAsaas } from '../../../test/fake-asaas';
import { startFakeLlm } from '../../../test/fake-llm';
import { ECHO_CHARGE, FAKE_PROVIDER_KEY, setupGateway } from '../../../test/gateway-fixtures';
import { APP_URL, createTestApp, createUserSession, resetDb } from '../../../test/helpers';
import { applyRefund, createOrgTopup } from '../payments/service';
import { applyLedger } from './wallet';

/** D-128: a prepaid customer only spends what it paid for. The balance never goes below zero. */
describe('prepaid balance never goes negative', () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let fake: Awaited<ReturnType<typeof startFakeLlm>>;
  let asaas: Awaited<ReturnType<typeof startFakeAsaas>>;

  beforeAll(async () => {
    fake = await startFakeLlm(FAKE_PROVIDER_KEY);
    asaas = await startFakeAsaas();
    ctx = await createTestApp({ env: { ASAAS_API_URL: asaas.baseUrl } });
  });
  afterAll(async () => {
    await ctx.app.close();
    await fake.close();
    await asaas.close();
  });
  beforeEach(async () => {
    await resetDb();
    ctx.app.caches.invalidate();
  });

  const chat = (key: string, body: object = {}) =>
    ctx.app.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: { authorization: `Bearer ${key}` },
      payload: { model: 'fuse/echo', messages: [{ role: 'user', content: 'Oi' }], ...body },
    });

  it('charges at most the available balance when the answer costs more than reserved', async () => {
    // 200 micros: enough for the reservation of a 1-token answer, less than the real 242.
    const g = await setupGateway(ctx.env, fake.baseUrl, { balanceMicros: 200n });
    const res = await chat(g.plain, { max_tokens: 1 });
    expect(res.statusCode).toBe(200);
    const w = await prisma.wallet.findUniqueOrThrow({ where: { id: g.walletId } });
    expect(w.balanceMicros).toBe(0n);
    expect(w.reservedMicros).toBe(0n);
    const log = await prisma.usageLog.findFirstOrThrow();
    expect(log.chargedMicros).toBe(200n);
    expect(log.errorCode).toContain('charge_capped');
    expect(ECHO_CHARGE).toBeGreaterThan(200n);

    // No balance left: refused, never "fiado".
    const next = await chat(g.plain);
    expect(next.statusCode).toBe(402);
    expect(
      (await prisma.wallet.findUniqueOrThrow({ where: { id: g.walletId } })).balanceMicros,
    ).toBe(0n);
  });

  it('admin cannot debit more than the available balance', async () => {
    const admin = await createUserSession(ctx.app, 'admin@example.com', 'SUPER_ADMIN');
    const g = await setupGateway(ctx.env, fake.baseUrl, { balanceMicros: 1_000_000n });
    const debit = (amountMicros: string) =>
      ctx.app.inject({
        method: 'POST',
        url: `/internal/admin/organizations/${g.org.id}/wallet/adjust`,
        headers: { cookie: admin, origin: APP_URL },
        payload: { amountMicros, reason: 'Correção de teste' },
      });
    expect((await debit('-1000001')).statusCode).toBe(400);
    expect((await debit('-1000000')).statusCode).toBe(201);
    expect(
      (await prisma.wallet.findUniqueOrThrow({ where: { id: g.walletId } })).balanceMicros,
    ).toBe(0n);
  });

  it('refunds: the admin button refuses used credits; an outside refund never goes negative and suspends', async () => {
    const admin = await createUserSession(ctx.app, 'admin@example.com', 'SUPER_ADMIN');
    const g = await setupGateway(ctx.env, fake.baseUrl, { balanceMicros: 0n });
    await prisma.organization.update({
      where: { id: g.org.id },
      data: { document: '11222333000181' },
    });
    const settings = await ctx.app.inject({
      method: 'GET',
      url: '/internal/admin/settings',
      headers: { cookie: admin },
    });
    const payment = await createOrgTopup(prisma, ctx.provider, settings.json(), g.org.id, {
      amountCents: 1000,
    });
    // Credit it as if paid, then the customer spends R$ 8 of the R$ 10.
    await prisma.payment.update({
      where: { id: payment.id },
      data: { status: 'RECEIVED', creditedAt: new Date(), paidAt: new Date() },
    });
    await prisma.$transaction(async (tx) => {
      await applyLedger(tx, {
        walletId: g.walletId,
        type: 'PURCHASE',
        amountMicros: 10_000_000n,
        referenceType: 'payment',
        referenceId: payment.id,
      });
      await applyLedger(tx, {
        walletId: g.walletId,
        type: 'USAGE',
        amountMicros: -8_000_000n,
        referenceType: 'usage',
        referenceId: 'consumo-teste',
      });
    });

    const button = await ctx.app.inject({
      method: 'POST',
      url: `/internal/admin/payments/${payment.id}/refund`,
      headers: { cookie: admin, origin: APP_URL },
    });
    expect(button.statusCode).toBe(409);
    expect(button.json().error.code).toBe('credits_already_used');

    // The refund happened outside fusai (Asaas panel / MED): debit only what is left.
    expect(await applyRefund(prisma, payment.id)).toBe(true);
    const w = await prisma.wallet.findUniqueOrThrow({ where: { id: g.walletId } });
    expect(w.balanceMicros).toBe(0n);
    expect((await prisma.organization.findUniqueOrThrow({ where: { id: g.org.id } })).status).toBe(
      'SUSPENDED',
    );
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'payment.refund_shortfall' },
    });
    expect(audit.metadata).toMatchObject({ shortfallMicros: '8000000', suspended: true });
  });
});
