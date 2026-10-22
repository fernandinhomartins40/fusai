import { prisma } from '@fusai/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { startFakeAsaas } from '../../../test/fake-asaas';
import { startFakeLlm } from '../../../test/fake-llm';
import { FAKE_PROVIDER_KEY, setupGateway } from '../../../test/gateway-fixtures';
import { createTestApp, createUserSession, resetDb } from '../../../test/helpers';
import { upsertAppUser } from '../app-users/service';
import { applyLedger } from '../billing/wallet';
import {
  applyRefund,
  createAppUserCheckout,
  createOrgTopup,
  creditPayment,
  processPendingWebhookEvents,
  reconcilePayments,
} from './service';

const TOKEN = 'test-webhook-token-123';

/**
 * Auditoria PIE R-01/R-06/R-07/R-11 (docs/pie/_parciais/receita_pagamentos.md): estornos,
 * contestações e reconciliação com o Asaas, com as regras decididas pelo dono.
 */
describe('PIE: estornos e contestações', () => {
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
    ctx.jobs.jobs.length = 0;
  });

  const webhook = (body: object) =>
    ctx.app.inject({
      method: 'POST',
      url: '/webhooks/asaas',
      payload: body,
      headers: { 'asaas-access-token': TOKEN },
    });

  /** A R$ 10 org top-up, paid and credited. */
  async function creditedTopup() {
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
    const providerId = payment.providerPaymentId as string;
    asaas.pay(providerId);
    await prisma.payment.update({
      where: { id: payment.id },
      data: { status: 'RECEIVED', creditedAt: new Date(), paidAt: new Date() },
    });
    await prisma.$transaction((tx) =>
      applyLedger(tx, {
        walletId: g.walletId,
        type: 'PURCHASE',
        amountMicros: payment.creditMicros,
        referenceType: 'payment',
        referenceId: payment.id,
      }),
    );
    return { g, payment, providerId };
  }

  const balance = async (walletId: string) =>
    (await prisma.wallet.findUniqueOrThrow({ where: { id: walletId } })).balanceMicros;

  it('R-06: PAYMENT_REFUNDED sem confirmação no Asaas não debita e fica pendente', async () => {
    const { g, payment, providerId } = await creditedTopup();
    const before = await balance(g.walletId);

    // The webhook claims a refund, but Asaas still says RECEIVED.
    await webhook(asaas.webhookBody('PAYMENT_REFUNDED', providerId));
    await processPendingWebhookEvents(prisma, ctx.provider);
    expect(await balance(g.walletId)).toBe(before);
    const stored = await prisma.inboundWebhookEvent.findFirstOrThrow({
      where: { type: 'PAYMENT_REFUNDED' },
    });
    expect(stored.processedAt).toBeNull();
    expect(stored.error).toContain('refund_not_confirmed');

    // Once Asaas confirms it, the sweep debits exactly once.
    const remote = asaas.payments.get(providerId);
    if (remote) remote.status = 'REFUNDED';
    await processPendingWebhookEvents(prisma, ctx.provider);
    await processPendingWebhookEvents(prisma, ctx.provider);
    expect(await balance(g.walletId)).toBe(before - payment.creditMicros);
    expect(
      await prisma.ledgerEntry.count({ where: { type: 'REFUND', referenceId: payment.id } }),
    ).toBe(1);
  });

  const sweep = () => processPendingWebhookEvents(prisma, ctx.provider);
  const wallet = (walletId: string) => prisma.wallet.findUniqueOrThrow({ where: { id: walletId } });
  const chat = (token: string) =>
    ctx.app.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: { authorization: `Bearer ${token}` },
      payload: { model: 'fuse/echo', messages: [{ role: 'user', content: 'Oi' }], max_tokens: 1 },
    });

  it('R-06: estorno parcial desconta a fração proporcional (com bônus); o total depois só o resto', async () => {
    const { g, payment, providerId } = await creditedTopup();
    // R$ 10 pagos que viraram R$ 11 em créditos (R$ 1 de bônus).
    await prisma.$transaction((tx) =>
      applyLedger(tx, {
        walletId: g.walletId,
        type: 'BONUS',
        amountMicros: 1_000_000n,
        referenceType: 'payment',
        referenceId: payment.id,
      }),
    );
    await prisma.payment.update({ where: { id: payment.id }, data: { creditMicros: 11_000_000n } });
    const before = await balance(g.walletId);

    // R$ 5 de R$ 10 estornados no Asaas: metade dos créditos (R$ 5,50).
    asaas.refundValue(providerId, 5);
    await webhook(asaas.webhookBody('PAYMENT_PARTIALLY_REFUNDED', providerId));
    await webhook(asaas.webhookBody('PAYMENT_PARTIALLY_REFUNDED', providerId)); // reentrega
    await sweep();
    expect(await balance(g.walletId)).toBe(before - 5_500_000n);
    expect(await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).toMatchObject({
      refundedMicros: 5_500_000n,
      status: 'RECEIVED',
    });

    // O resto estornado depois: só a diferença sai, nunca de novo o que já saiu.
    asaas.refundValue(providerId, 5);
    await webhook(asaas.webhookBody('PAYMENT_REFUNDED', providerId));
    await sweep();
    expect(await balance(g.walletId)).toBe(before - 11_000_000n);
    expect(await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).toMatchObject({
      refundedMicros: 11_000_000n,
      status: 'REFUNDED',
    });
    expect(await prisma.ledgerEntry.count({ where: { type: 'REFUND' } })).toBe(2);
    expect(await prisma.inboundWebhookEvent.count({ where: { processedAt: null } })).toBe(0);
  });

  it('chargeback congela os créditos da recarga; disputa ganha libera', async () => {
    const { g, providerId } = await creditedTopup();
    expect((await chat(g.plain)).statusCode).toBe(200);
    const remote = asaas.payments.get(providerId);
    if (remote) remote.status = 'CHARGEBACK_REQUESTED';
    await webhook(asaas.webhookBody('PAYMENT_CHARGEBACK_REQUESTED', providerId));
    await webhook(asaas.webhookBody('PAYMENT_CHARGEBACK_DISPUTE', providerId));
    await sweep();

    const frozen = await wallet(g.walletId);
    expect(frozen.reservedMicros).toBe(frozen.balanceMicros); // tudo o que sobrou da recarga
    expect(await prisma.walletHold.count()).toBe(1);
    expect(await prisma.auditLog.count({ where: { action: 'payment.chargeback_frozen' } })).toBe(1);
    // Congelado não se gasta: a organização continua ativa, mas sem saldo disponível.
    const blocked = await chat(g.plain);
    expect(blocked.statusCode).toBe(402);
    expect((await prisma.organization.findUniqueOrThrow({ where: { id: g.org.id } })).status).toBe(
      'ACTIVE',
    );

    // Disputa ganha: o Asaas volta a dizer RECEIVED.
    if (remote) remote.status = 'RECEIVED';
    await webhook(asaas.webhookBody('PAYMENT_RECEIVED', providerId, 'evt_won'));
    await sweep();
    expect((await wallet(g.walletId)).reservedMicros).toBe(0n);
    expect(await prisma.walletHold.count()).toBe(0);
    expect((await chat(g.plain)).statusCode).toBe(200);
  });

  it('chargeback perdido vira estorno; usuário final que gastou fica bloqueado (R-07) e o painel desbloqueia', async () => {
    const g = await setupGateway(ctx.env, fake.baseUrl);
    const project = await prisma.project.update({
      where: { id: g.project.id },
      data: { billingMode: 'END_USER_WALLET', webhookUrl: 'https://cliente.example.com/hook' },
    });
    const { user, wallet: userWallet } = await upsertAppUser(prisma, project, {
      externalId: 'contestador',
    });
    const payment = await prisma.payment.create({
      data: {
        walletId: userWallet.id,
        orgId: g.org.id,
        projectId: project.id,
        appUserId: user.id,
        status: 'RECEIVED',
        amountCents: 5000,
        creditMicros: 50_000_000n,
        creditedAt: new Date(),
        idempotencyKey: 'pie-chargeback',
      },
    });
    const { providerPaymentId } = await ctx.provider.createPixCharge({
      customerId: 'cus_teste',
      amountCents: 5000,
      description: 'Pacote',
      externalRef: payment.id,
      dueDate: new Date(),
    });
    await prisma.payment.update({ where: { id: payment.id }, data: { providerPaymentId } });
    asaas.pay(providerPaymentId);
    await prisma.$transaction(async (tx) => {
      await applyLedger(tx, {
        walletId: userWallet.id,
        type: 'PURCHASE',
        amountMicros: 50_000_000n,
        referenceType: 'payment',
        referenceId: payment.id,
      });
      await applyLedger(tx, {
        walletId: userWallet.id,
        type: 'USAGE',
        amountMicros: -30_000_000n,
        referenceType: 'usage',
        referenceId: 'consumo-chargeback',
      });
    });

    const remote = asaas.payments.get(providerPaymentId);
    if (remote) remote.status = 'CHARGEBACK_REQUESTED';
    await webhook(asaas.webhookBody('PAYMENT_CHARGEBACK_REQUESTED', providerPaymentId));
    await sweep();
    expect((await wallet(userWallet.id)).reservedMicros).toBe(20_000_000n);
    const blockedUser = await prisma.appUser.findUniqueOrThrow({ where: { id: user.id } });
    expect(blockedUser.blockedAt).not.toBeNull();
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: { authorization: `Bearer ${g.plain}`, 'x-fuse-user': 'contestador' },
      payload: { model: 'fuse/echo', messages: [{ role: 'user', content: 'Oi' }] },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('end_user_blocked');

    // Disputa perdida: o Asaas devolve o dinheiro; o congelado sai, o resto é shortfall.
    if (remote) remote.status = 'REFUNDED';
    await webhook(asaas.webhookBody('PAYMENT_REFUNDED', providerPaymentId));
    await sweep();
    const after = await wallet(userWallet.id);
    expect(after).toMatchObject({ balanceMicros: 0n, reservedMicros: 0n });
    expect(await prisma.walletHold.count()).toBe(0);
    const event = await prisma.outboundWebhook.findFirstOrThrow({
      where: { event: 'payment.refunded' },
    });
    expect((event.payload as { data: unknown }).data).toMatchObject({
      refund: { debitedMicros: '20000000', shortfallMicros: '30000000', partial: false },
    });

    // O dono do app pode desbloquear pelo painel.
    const email = `dono-${g.org.id}@example.com`;
    const cookie = await createUserSession(ctx.app, email);
    const owner = await prisma.user.findUniqueOrThrow({ where: { email } });
    await prisma.membership.create({ data: { userId: owner.id, orgId: g.org.id, role: 'OWNER' } });
    const unblock = await ctx.app.inject({
      method: 'POST',
      url: `/internal/projects/${project.id}/app-users/${user.id}/unblock`,
      headers: { cookie, origin: 'http://localhost:3000' },
    });
    expect(unblock.statusCode).toBe(200);
    expect(unblock.json().blockedAt).toBeNull();
  });

  it('R-11: Pix pago depois de expirar é creditado pela reconciliação; o evento não confirmado fica aberto', async () => {
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
    const providerId = payment.providerPaymentId as string;
    // O OVERDUE foi processado antes: o pagamento ficou EXPIRED.
    await prisma.payment.update({ where: { id: payment.id }, data: { status: 'EXPIRED' } });

    // O RECEIVED chega, mas o Asaas ainda diz PENDING: o evento não é fechado.
    await webhook(asaas.webhookBody('PAYMENT_RECEIVED', providerId));
    await sweep();
    const open = await prisma.inboundWebhookEvent.findFirstOrThrow();
    expect(open.processedAt).toBeNull();
    expect(open.error).toBe('not_paid:PENDING');

    asaas.pay(providerId);
    expect(await reconcilePayments(prisma, ctx.provider)).toMatchObject({ credited: 1 });
    expect(await balance(g.walletId)).toBe(10_000_000n);
    expect(await reconcilePayments(prisma, ctx.provider)).toMatchObject({ credited: 0 });
    await sweep();
    expect(await prisma.inboundWebhookEvent.count({ where: { processedAt: null } })).toBe(0);
    expect(await balance(g.walletId)).toBe(10_000_000n);
  });

  it('R-01: o bônus do pacote do usuário final é pago pela organização (ou não é dado sem saldo)', async () => {
    const g = await setupGateway(ctx.env, fake.baseUrl, { balanceMicros: 0n });
    const project = await prisma.project.update({
      where: { id: g.project.id },
      data: { billingMode: 'END_USER_WALLET' },
      include: { org: true },
    });
    // Pacote antigo, criado antes da regra: R$ 9,90 que davam R$ 12 + R$ 1 de bônus.
    const pkg = await prisma.creditPackage.create({
      data: {
        projectId: project.id,
        name: 'Antigo',
        priceCents: 990,
        creditMicros: 12_000_000n,
        bonusMicros: 1_000_000n,
      },
    });
    const buy = async (externalId: string) => {
      const { user } = await upsertAppUser(prisma, project, { externalId });
      const appUser = await prisma.appUser.findUniqueOrThrow({
        where: { id: user.id },
        include: { wallet: true },
      });
      const p = await createAppUserCheckout(prisma, ctx.provider, project, appUser, {
        packageId: pkg.id,
        document: '529.982.247-25',
      });
      asaas.pay(p.providerPaymentId as string);
      expect((await creditPayment(prisma, ctx.provider, p.id)).credited).toBe(true);
      return { p, walletId: appUser.wallet?.id as string };
    };

    // Org sem saldo: o comprador recebe só o que pagou (R$ 9,90).
    const first = await buy('sem-bonus');
    expect(await balance(first.walletId)).toBe(9_900_000n);
    expect(
      (await prisma.payment.findUniqueOrThrow({ where: { id: first.p.id } })).creditMicros,
    ).toBe(9_900_000n);
    expect(await prisma.auditLog.count({ where: { action: 'payment.bonus_skipped' } })).toBe(1);

    // Org com saldo: os R$ 3,10 acima do preço saem da carteira da organização.
    await prisma.wallet.update({ where: { id: g.walletId }, data: { balanceMicros: 5_000_000n } });
    const second = await buy('com-bonus');
    expect(await balance(second.walletId)).toBe(13_000_000n);
    expect(await balance(g.walletId)).toBe(1_900_000n);
  });

  it('R-07: estorno de compra do usuário final informa o valor já consumido no webhook', async () => {
    const g = await setupGateway(ctx.env, fake.baseUrl);
    const project = await prisma.project.update({
      where: { id: g.project.id },
      data: { billingMode: 'END_USER_WALLET', webhookUrl: 'https://cliente.example.com/hook' },
    });
    const { user } = await upsertAppUser(prisma, project, { externalId: 'comprador' });
    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { appUserId: user.id } });
    const payment = await prisma.payment.create({
      data: {
        walletId: wallet.id,
        orgId: g.org.id,
        projectId: project.id,
        appUserId: user.id,
        status: 'RECEIVED',
        amountCents: 5000,
        creditMicros: 50_000_000n,
        creditedAt: new Date(),
        idempotencyKey: 'pie-r07',
      },
    });
    // Bought R$ 50 and used R$ 30 of it before the MED came back.
    await prisma.$transaction(async (tx) => {
      await applyLedger(tx, {
        walletId: wallet.id,
        type: 'PURCHASE',
        amountMicros: 50_000_000n,
        referenceType: 'payment',
        referenceId: payment.id,
      });
      await applyLedger(tx, {
        walletId: wallet.id,
        type: 'USAGE',
        amountMicros: -30_000_000n,
        referenceType: 'usage',
        referenceId: 'consumo-r07',
      });
    });

    expect(await applyRefund(prisma, payment.id)).toBe(true);
    expect(await balance(wallet.id)).toBe(0n);
    const event = await prisma.outboundWebhook.findFirstOrThrow({
      where: { event: 'payment.refunded' },
    });
    expect((event.payload as { data: unknown }).data).toMatchObject({
      refund: { debitedMicros: '20000000', shortfallMicros: '30000000' },
      appUser: { externalId: 'comprador' },
    });
  });
});
