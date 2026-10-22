import { prisma } from '@fusai/db';
import { DEFAULT_MAX_OUTPUT_FOR_HOLD } from '@fusai/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { startFakeLlm } from '../../../test/fake-llm';
import { FAKE_PROVIDER_KEY, setupGateway } from '../../../test/gateway-fixtures';
import { createTestApp, createUserSession, resetDb } from '../../../test/helpers';
import { issueSessionToken, upsertAppUser } from '../app-users/service';
import { createPackage } from '../mcp/actions';

/**
 * Auditoria PIE (docs/pie/_parciais/receita_pagamentos.md): testes NEGATIVOS que descrevem o
 * comportamento correto. R-01 (regra do dono): crédito dado a usuário final sai da carteira da
 * organização, e pacote do projeto não dá mais créditos do que o preço pago.
 */
describe('PIE: proteção de receita', () => {
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

  const chat = (token: string, body: object = {}) =>
    ctx.app.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: { authorization: `Bearer ${token}` },
      payload: { model: 'fuse/echo', messages: [{ role: 'user', content: 'Oi' }], ...body },
    });

  it('R-02: o provedor nunca recebe um limite de saída maior que o usado na reserva', async () => {
    const g = await setupGateway(ctx.env, fake.baseUrl);
    const res = await chat(g.plain, { max_completion_tokens: 1, max_tokens: 100_000 });
    expect(res.statusCode).toBe(200);
    const sent = fake.requests.at(-1)?.body ?? {};
    // A reserva usou 1 token de saída: um único campo de teto, com esse valor.
    expect(sent.max_completion_tokens).toBe(1);
    expect(sent.max_tokens).toBeUndefined();
  });

  it('R-02: sem max_tokens o gateway envia o mesmo teto usado na reserva', async () => {
    const g = await setupGateway(ctx.env, fake.baseUrl);
    // A model whose max output is above the hold default: the provider must not get more.
    await prisma.model.update({ where: { slug: 'fuse/echo' }, data: { maxOutputTokens: 32_768 } });
    await chat(g.plain);
    const sent = fake.requests.at(-1)?.body ?? {};
    expect(sent.max_tokens).toBe(DEFAULT_MAX_OUTPUT_FOR_HOLD);
  });

  it('R-02: max_tokens acima do máximo do modelo é cortado no máximo', async () => {
    const g = await setupGateway(ctx.env, fake.baseUrl);
    await chat(g.plain, { max_tokens: 10_000_000 });
    const sent = fake.requests.at(-1)?.body ?? {};
    const model = await prisma.model.findFirstOrThrow({ where: { slug: 'fuse/echo' } });
    expect(sent.max_tokens).toBe(model.maxOutputTokens);
  });

  it('R-01: pacote do projeto não pode dar mais créditos do que o preço pago', async () => {
    const g = await setupGateway(ctx.env, fake.baseUrl);
    const r = await createPackage(prisma, g.project.id, {
      name: 'Abuso',
      price_brl: '5.00',
      credits_brl: '10000.00',
      bonus_brl: '10000.00',
    });
    expect(r.ok).toBe(false);
  });

  it('R-01: crédito grátis do usuário final sai da carteira da organização (soma global constante)', async () => {
    const g = await setupGateway(ctx.env, fake.baseUrl, { balanceMicros: 10_000_000n });
    const project = await prisma.project.update({
      where: { id: g.project.id },
      data: { billingMode: 'END_USER_WALLET', freeCreditMicros: 1_000_000_000n },
    });
    const before = await prisma.wallet.aggregate({ _sum: { balanceMicros: true } });
    await upsertAppUser(prisma, project, { externalId: 'sybil-1' }).catch(() => null);
    const after = await prisma.wallet.aggregate({ _sum: { balanceMicros: true } });
    // Antes: +R$ 1.000 surgiam do nada. Agora: a org (R$ 10) não cobre, o usuário nasce sem crédito.
    expect(after._sum.balanceMicros).toBe(before._sum.balanceMicros);
  });

  it('R-01: com saldo, o crédito grátis é uma transferência da organização', async () => {
    const g = await setupGateway(ctx.env, fake.baseUrl, { balanceMicros: 10_000_000n });
    const project = await prisma.project.update({
      where: { id: g.project.id },
      data: { billingMode: 'END_USER_WALLET', freeCreditMicros: 2_000_000n },
    });
    const r = await upsertAppUser(prisma, project, { externalId: 'novo' });
    expect(r.freeCredit).toBe('granted');
    expect(r.wallet.balanceMicros).toBe(2_000_000n);
    const org = await prisma.wallet.findUniqueOrThrow({ where: { id: g.walletId } });
    expect(org.balanceMicros).toBe(8_000_000n);
    const out = await prisma.ledgerEntry.findFirstOrThrow({ where: { type: 'TRANSFER_OUT' } });
    expect(out).toMatchObject({ walletId: g.walletId, amountMicros: -2_000_000n });

    // Sem saldo: o usuário é criado, sem o crédito, e a API informa o motivo.
    await prisma.wallet.update({ where: { id: g.walletId }, data: { balanceMicros: 0n } });
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/v1/app-users',
      headers: { authorization: `Bearer ${g.plain}` },
      payload: { externalId: 'sem-saldo' },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      balanceMicros: '0',
      freeCredit: 'insufficient_org_balance',
    });
  });

  it('R-01: cortesia do painel sai da organização e é recusada (402) sem saldo', async () => {
    const g = await setupGateway(ctx.env, fake.baseUrl, { balanceMicros: 3_000_000n });
    const project = await prisma.project.update({
      where: { id: g.project.id },
      data: { billingMode: 'END_USER_WALLET', freeCreditMicros: 0n },
    });
    const { user } = await upsertAppUser(prisma, project, { externalId: 'vip' });
    const email = `dono-${g.org.id}@example.com`;
    const cookie = await createUserSession(ctx.app, email);
    const owner = await prisma.user.findUniqueOrThrow({ where: { email } });
    await prisma.membership.create({ data: { userId: owner.id, orgId: g.org.id, role: 'OWNER' } });
    const adjust = (amountMicros: string, key: string) =>
      ctx.app.inject({
        method: 'POST',
        url: `/internal/projects/${project.id}/app-users/${user.id}/adjust`,
        headers: { cookie, origin: 'http://localhost:3000', 'idempotency-key': key },
        payload: { amountMicros, description: 'Cortesia' },
      });

    expect((await adjust('2000000', 'cortesia-0001')).json().balanceMicros).toBe('2000000');
    // R-09: o mesmo clique repetido não credita de novo.
    expect((await adjust('2000000', 'cortesia-0001')).json().balanceMicros).toBe('2000000');
    const org = await prisma.wallet.findUniqueOrThrow({ where: { id: g.walletId } });
    expect(org.balanceMicros).toBe(1_000_000n);

    const refused = await adjust('2000000', 'cortesia-0002');
    expect(refused.statusCode).toBe(402);
    expect(refused.json().error.code).toBe('insufficient_org_balance');
    const sum = await prisma.wallet.aggregate({ _sum: { balanceMicros: true } });
    expect(sum._sum.balanceMicros).toBe(3_000_000n);
  });

  /** Session token issued by the key itself, through the public route. */
  const sessionTokenFor = async (plain: string, externalId: string) => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/v1/app-users/${externalId}/session-token`,
      headers: { authorization: `Bearer ${plain}` },
    });
    expect(res.statusCode).toBe(200);
    return res.json().token as string;
  };

  it('R-04: session token respeita o limite de gasto mensal da chave que o emitiu', async () => {
    const g = await setupGateway(ctx.env, fake.baseUrl, { spendLimitMicros: 1n });
    await upsertAppUser(prisma, g.project, { externalId: 'u1' });
    const res = await chat(await sessionTokenFor(g.plain, 'u1'), { max_tokens: 1 });
    expect(res.statusCode).toBe(402);
    expect(res.json().error.code).toBe('spend_limit_reached');
    expect(await prisma.walletHold.count()).toBe(0);
  });

  it('R-04: o consumo por session token conta no limite da chave que o emitiu', async () => {
    const g = await setupGateway(ctx.env, fake.baseUrl, { spendLimitMicros: 1_000_000n });
    await upsertAppUser(prisma, g.project, { externalId: 'u1' });
    const res = await chat(await sessionTokenFor(g.plain, 'u1'), { max_tokens: 1 });
    expect(res.statusCode).toBe(200);
    const log = await prisma.usageLog.findFirstOrThrow({ where: { status: 'SUCCESS' } });
    expect(log.apiKeyId).toBe(g.key.id);
    expect(log.chargedMicros).toBeGreaterThan(0n);
  });

  it('R-04: token antigo, sem a chave emissora, continua funcionando', async () => {
    const g = await setupGateway(ctx.env, fake.baseUrl, { spendLimitMicros: 1n });
    const { user } = await upsertAppUser(prisma, g.project, { externalId: 'u1' });
    const { token } = issueSessionToken(user.id, g.project.id, ctx.env.SESSION_TOKEN_SECRET);
    expect((await chat(token, { max_tokens: 1 })).statusCode).toBe(200);
  });

  it('R-05: requisições concorrentes não estouram o spendLimit da chave', async () => {
    const limit = 300n;
    const g = await setupGateway(ctx.env, fake.baseUrl, { spendLimitMicros: limit });
    const results = await Promise.all(
      Array.from({ length: 10 }, () => chat(g.plain, { max_tokens: 1 })),
    );
    const codes = results.map((r) => r.statusCode);
    expect(codes).toContain(200);
    expect(codes).toContain(402);
    const agg = await prisma.usageLog.aggregate({
      where: { apiKeyId: g.key.id },
      _sum: { chargedMicros: true },
    });
    expect(agg._sum.chargedMicros ?? 0n).toBeLessThanOrEqual(limit);
    // Every hold was settled or released: nothing stays counted against the limit.
    expect(await prisma.walletHold.count()).toBe(0);
  });

  it('R-05: session tokens concorrentes também respeitam o limite da chave', async () => {
    const limit = 300n;
    const g = await setupGateway(ctx.env, fake.baseUrl, { spendLimitMicros: limit });
    const tokens: string[] = [];
    for (const id of ['a', 'b', 'c', 'd', 'e']) {
      await upsertAppUser(prisma, g.project, { externalId: id });
      tokens.push(await sessionTokenFor(g.plain, id));
    }
    await Promise.all(
      tokens.flatMap((t) => [chat(t, { max_tokens: 1 }), chat(t, { max_tokens: 1 })]),
    );
    const agg = await prisma.usageLog.aggregate({
      where: { apiKeyId: g.key.id },
      _sum: { chargedMicros: true },
    });
    expect(agg._sum.chargedMicros ?? 0n).toBeLessThanOrEqual(limit);
  });
});
