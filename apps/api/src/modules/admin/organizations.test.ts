import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { APP_URL, createTestApp, createUserSession, resetDb } from '../../../test/helpers';

describe('wallet statement and admin adjustments', () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let admin: string;
  let owner: string;
  let orgId: string;

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(async () => {
    await ctx.app.close();
  });
  beforeEach(async () => {
    await resetDb();
    admin = await createUserSession(ctx.app, 'admin@example.com', 'SUPER_ADMIN');
    owner = await createUserSession(ctx.app, 'dono@example.com');
    const res = await call('POST', '/internal/onboarding/organization', owner, {
      name: 'Cliente Um',
      document: '52998224725',
      phone: '11999990000',
    });
    orgId = res.json().id;
  });

  const call = (method: 'GET' | 'POST', url: string, cookie: string, payload?: object) =>
    ctx.app.inject({ method, url, payload, headers: { cookie, origin: APP_URL } });

  it('admin adjustment shows in the customer statement and in the audit log', async () => {
    const credit = await call(
      'POST',
      `/internal/admin/organizations/${orgId}/wallet/adjust`,
      admin,
      {
        amountMicros: '10000000',
        reason: 'Crédito de cortesia pelo onboarding',
      },
    );
    expect(credit.statusCode).toBe(201);
    expect(credit.json()).toMatchObject({ type: 'ADJUSTMENT', balanceAfter: '10000000' });

    const debit = await call(
      'POST',
      `/internal/admin/organizations/${orgId}/wallet/adjust`,
      admin,
      {
        amountMicros: '-2500000',
        reason: 'Estorno de crédito lançado em duplicidade',
      },
    );
    expect(debit.json()).toMatchObject({ amountMicros: '-2500000', balanceAfter: '7500000' });

    const wallet = await call('GET', `/internal/organizations/${orgId}/wallet`, owner);
    expect(wallet.json()).toMatchObject({
      balanceMicros: '7500000',
      reservedMicros: '0',
      availableMicros: '7500000',
      billingType: 'PREPAID',
    });

    const ledger = await call('GET', `/internal/organizations/${orgId}/wallet/ledger`, owner);
    expect(ledger.json().items.map((e: { description: string }) => e.description)).toEqual([
      'Estorno de crédito lançado em duplicidade',
      'Crédito de cortesia pelo onboarding',
    ]);

    const audits = await ctx.prisma.auditLog.findMany({ where: { action: 'wallet.adjust' } });
    expect(audits).toHaveLength(2);
    expect(audits[0]).toMatchObject({ target: orgId });
    expect(audits[0]?.actorId).toBeTruthy();
    expect(audits[0]?.metadata).toMatchObject({
      reason: expect.any(String),
      amountMicros: expect.any(String),
    });

    const detail = await call('GET', `/internal/admin/organizations/${orgId}`, admin);
    expect(detail.json().wallet).toMatchObject({
      balanceMicros: '7500000',
      consistent: true,
      activeHolds: 0,
    });
  });

  it('validates adjustments', async () => {
    const url = `/internal/admin/organizations/${orgId}/wallet/adjust`;
    expect(
      (await call('POST', url, admin, { amountMicros: '0', reason: 'motivo válido' })).statusCode,
    ).toBe(400);
    expect((await call('POST', url, admin, { amountMicros: '1000' })).statusCode).toBe(400);
    expect(
      (await call('POST', url, admin, { amountMicros: '1.5', reason: 'motivo válido' })).statusCode,
    ).toBe(400);
    expect(
      (await call('POST', url, admin, { amountMicros: '1000000000001', reason: 'motivo válido' }))
        .statusCode,
    ).toBe(400);
    expect(
      (await call('POST', url, owner, { amountMicros: '1000', reason: 'auto crédito' })).statusCode,
    ).toBe(403);
  });

  it('paginates the statement with a cursor', async () => {
    for (let i = 1; i <= 5; i++) {
      await call('POST', `/internal/admin/organizations/${orgId}/wallet/adjust`, admin, {
        amountMicros: String(i * 1000),
        reason: `lançamento ${i}`,
      });
    }
    const first = (
      await call('GET', `/internal/organizations/${orgId}/wallet/ledger?limit=2`, owner)
    ).json();
    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).toBeTruthy();
    const second = (
      await call(
        'GET',
        `/internal/organizations/${orgId}/wallet/ledger?limit=2&cursor=${first.nextCursor}`,
        owner,
      )
    ).json();
    const third = (
      await call(
        'GET',
        `/internal/organizations/${orgId}/wallet/ledger?limit=2&cursor=${second.nextCursor}`,
        owner,
      )
    ).json();
    const all = [...first.items, ...second.items, ...third.items].map(
      (e: { description: string }) => e.description,
    );
    expect(all).toEqual([
      'lançamento 5',
      'lançamento 4',
      'lançamento 3',
      'lançamento 2',
      'lançamento 1',
    ]);
    expect(third.nextCursor).toBeNull();
  });

  it('keeps statements private to members and lists customers for the admin', async () => {
    const stranger = await createUserSession(ctx.app, 'outro@example.com');
    expect(
      (await call('GET', `/internal/organizations/${orgId}/wallet`, stranger)).statusCode,
    ).toBe(404);
    expect(
      (await call('GET', `/internal/organizations/${orgId}/wallet/ledger`, stranger)).statusCode,
    ).toBe(404);

    const list = await call('GET', '/internal/admin/organizations?q=529.982', admin);
    expect(list.json().items).toMatchObject([
      { id: orgId, name: 'Cliente Um', balanceMicros: '0' },
    ]);
    expect(
      (await call('GET', '/internal/admin/organizations?q=dono@example', admin)).json().items,
    ).toHaveLength(1);
    expect(
      (await call('GET', '/internal/admin/organizations?q=nada-aqui', admin)).json().items,
    ).toHaveLength(0);
  });
});
