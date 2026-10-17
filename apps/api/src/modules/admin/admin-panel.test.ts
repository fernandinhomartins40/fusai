import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { APP_URL, createTestApp, createUserSession, resetDb, signIn } from '../../../test/helpers';
import { marginPct } from './dashboard';

/** Browser-like cookie jar: later Set-Cookie wins, Max-Age=0 deletes. */
function applyCookies(jar: string, setCookie: string | string[] | undefined): string {
  const cookies = new Map(
    jar
      .split('; ')
      .filter(Boolean)
      .map((c) => [c.slice(0, c.indexOf('=')), c.slice(c.indexOf('=') + 1)] as const),
  );
  for (const line of Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : []) {
    const [pair = ''] = line.split(';');
    const name = pair.slice(0, pair.indexOf('='));
    if (/max-age=0/i.test(line)) cookies.delete(name);
    else cookies.set(name, pair.slice(pair.indexOf('=') + 1));
  }
  return [...cookies].map(([k, v]) => `${k}=${v}`).join('; ');
}

describe('super admin panel', () => {
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
    ctx.jobs.jobs.length = 0;
    admin = await createUserSession(ctx.app, 'admin@example.com', 'SUPER_ADMIN');
    owner = await createUserSession(ctx.app, 'dono@example.com');
    const res = await call('POST', '/internal/onboarding/organization', owner, {
      name: 'Cliente Um',
      document: '52998224725',
      phone: '11999990000',
    });
    orgId = res.json().id;
  });

  const call = (
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    url: string,
    cookie: string,
    payload?: object,
  ) => ctx.app.inject({ method, url, payload, headers: { cookie, origin: APP_URL } });

  async function createProject() {
    const res = await call('POST', `/internal/organizations/${orgId}/projects`, owner, {
      name: 'Meu App',
    });
    return res.json() as { id: string };
  }

  async function seedUsage() {
    const provider = await ctx.prisma.provider.create({
      data: { slug: 'deepseek', name: 'DeepSeek', baseUrl: 'https://x.test', apiKeyEnc: '' },
    });
    const model = await ctx.prisma.model.create({
      data: {
        slug: 'fuse/deepseek-chat',
        displayName: 'DeepSeek Chat',
        providerId: provider.id,
        upstreamModel: 'deepseek-chat',
        contextWindow: 64000,
        inputCostUsdPerM: '0.27',
        outputCostUsdPerM: '1.1',
      },
    });
    const project = await createProject();
    const base = { orgId, projectId: project.id, modelId: model.id, providerId: provider.id };
    await ctx.prisma.usageLog.createMany({
      data: [
        {
          ...base,
          requestId: 'req-1',
          status: 'SUCCESS',
          chargedMicros: 400_000n,
          costBrlMicros: 100_000n,
          latencyMs: 800,
        },
        {
          ...base,
          requestId: 'req-2',
          status: 'SUCCESS',
          chargedMicros: 600_000n,
          costBrlMicros: 150_000n,
          latencyMs: 1200,
        },
        { ...base, requestId: 'req-3', status: 'UPSTREAM_ERROR', errorCode: 'upstream_500' },
      ],
    });
    return { provider, model };
  }

  it('computes margin percent without floats', () => {
    expect(marginPct(1_000_000n, 250_000n)).toBe('75.0');
    expect(marginPct(3_000_000n, 1_000_000n)).toBe('66.6');
    expect(marginPct(1_000_000n, 1_500_000n)).toBe('-50.0');
    expect(marginPct(0n, 0n)).toBeNull();
  });

  it('every admin route is closed to regular users', async () => {
    for (const url of [
      '/internal/admin/dashboard',
      '/internal/admin/users',
      '/internal/admin/packages',
      '/internal/admin/usage',
      '/internal/admin/webhook-events',
      '/internal/admin/audit',
      '/internal/admin/system',
      `/internal/admin/organizations/${orgId}/api-keys`,
    ]) {
      expect((await call('GET', url, owner)).statusCode, url).toBe(403);
    }
    const patch = await call('PATCH', `/internal/admin/organizations/${orgId}`, owner, {
      status: 'SUSPENDED',
      reason: 'tentativa indevida',
    });
    expect(patch.statusCode).toBe(403);
  });

  it('dashboard shows charged, provider cost, margin and wallet liability', async () => {
    await seedUsage();
    await call('POST', `/internal/admin/organizations/${orgId}/wallet/adjust`, admin, {
      amountMicros: '5000000',
      reason: 'Crédito de cortesia',
    });
    const res = await call('GET', '/internal/admin/dashboard?days=7', admin);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.totals).toMatchObject({
      requests: 3,
      errors: 1,
      chargedMicros: '1000000',
      costMicros: '250000',
      marginMicros: '750000',
      marginPct: '75.0',
    });
    expect(body.daily).toHaveLength(7);
    expect(body.topCustomers[0]).toMatchObject({ orgId, name: 'Cliente Um', requests: 3 });
    expect(body.topModels[0]).toMatchObject({ slug: 'fuse/deepseek-chat' });
    expect(body.providers[0]).toMatchObject({ slug: 'deepseek', errors: 1, avgLatencyMs: 1000 });
    expect(body.liability.organizationsMicros).toBe('5000000');
    expect(body.counts.organizations).toBe(1);
  });

  it('suspends (reason required), reactivates and changes billing, with audit', async () => {
    const noReason = await call('PATCH', `/internal/admin/organizations/${orgId}`, admin, {
      status: 'SUSPENDED',
    });
    expect(noReason.statusCode).toBe(400);

    const suspend = await call('PATCH', `/internal/admin/organizations/${orgId}`, admin, {
      status: 'SUSPENDED',
      reason: 'Chargeback em análise',
    });
    expect(suspend.json()).toMatchObject({ status: 'SUSPENDED' });

    const update = await call('PATCH', `/internal/admin/organizations/${orgId}`, admin, {
      status: 'ACTIVE',
      billingType: 'POSTPAID',
      creditLimitMicros: '50000000',
      markupOverride: '2,5',
    });
    expect(update.json()).toMatchObject({
      status: 'ACTIVE',
      billingType: 'POSTPAID',
      creditLimitMicros: '50000000',
      markupOverride: '2.5',
    });

    const clear = await call('PATCH', `/internal/admin/organizations/${orgId}`, admin, {
      markupOverride: null,
    });
    expect(clear.json().markupOverride).toBeNull();

    const actions = (
      await ctx.prisma.auditLog.findMany({
        where: { target: orgId },
        orderBy: { createdAt: 'asc' },
      })
    ).map((a) => a.action);
    expect(actions).toEqual(['org.suspend', 'org.reactivate', 'org.update']);

    const audit = await call('GET', '/internal/admin/audit?action=org.suspend', admin);
    expect(audit.json().items[0]).toMatchObject({
      action: 'org.suspend',
      target: orgId,
      actor: { email: 'admin@example.com' },
      metadata: { reason: 'Chargeback em análise' },
    });
  });

  it("lists and revokes a customer's API keys", async () => {
    const project = await createProject();
    const created = await call('POST', `/internal/projects/${project.id}/api-keys`, owner, {
      name: 'Produção',
    });
    expect(created.statusCode).toBe(201);
    const list = await call('GET', `/internal/admin/organizations/${orgId}/api-keys`, admin);
    const [key] = list.json().items;
    expect(key).toMatchObject({ name: 'Produção', revokedAt: null, project: { id: project.id } });
    expect(JSON.stringify(list.json())).not.toContain(created.json().key);

    const revoke = await call('POST', `/internal/admin/api-keys/${key.id}/revoke`, admin);
    expect(revoke.statusCode).toBe(200);
    const after = await call('GET', `/internal/admin/organizations/${orgId}/api-keys`, admin);
    expect(after.json().items[0].revokedAt).toBeTruthy();
    expect(await ctx.prisma.auditLog.count({ where: { action: 'api_key.revoke' } })).toBe(1);
  });

  it('bans a user (sessions revoked, sign-in refused) and unbans', async () => {
    const users = await call('GET', '/internal/admin/users?q=dono', admin);
    const [user] = users.json().items;
    expect(user).toMatchObject({ email: 'dono@example.com', banned: false });
    expect(user.organizations[0]).toMatchObject({ name: 'Cliente Um', role: 'OWNER' });

    const ban = await call('POST', `/internal/admin/users/${user.id}/ban`, admin, {
      reason: 'Uso abusivo da API',
    });
    expect(ban.json()).toMatchObject({ banned: true });
    expect(ban.json().sessionsRevoked).toBeGreaterThan(0);
    expect((await call('GET', '/internal/me', owner)).statusCode).toBe(401);
    expect((await signIn(ctx.app, 'dono@example.com')).res.statusCode).toBe(403);

    const adminUser = await ctx.prisma.user.findUniqueOrThrow({
      where: { email: 'admin@example.com' },
    });
    const banAdmin = await call('POST', `/internal/admin/users/${adminUser.id}/ban`, admin, {
      reason: 'Não deveria funcionar',
    });
    expect(banAdmin.statusCode).toBe(409);

    await call('POST', `/internal/admin/users/${user.id}/unban`, admin);
    expect((await signIn(ctx.app, 'dono@example.com')).res.statusCode).toBe(200);
  });

  it('impersonates a customer with an audit trail and returns to the admin session', async () => {
    const customer = await ctx.prisma.user.findUniqueOrThrow({
      where: { email: 'dono@example.com' },
    });
    // A regular user cannot impersonate.
    const denied = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/admin/impersonate-user',
      headers: { cookie: owner, origin: APP_URL },
      payload: { userId: customer.id },
    });
    expect(denied.statusCode).toBe(403);

    const start = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/admin/impersonate-user',
      headers: { cookie: admin, origin: APP_URL },
      payload: { userId: customer.id },
    });
    expect(start.statusCode).toBe(200);
    const asCustomer = applyCookies(admin, start.headers['set-cookie']);
    const me = await call('GET', '/internal/me', asCustomer);
    expect(me.json().user).toMatchObject({ email: 'dono@example.com', role: 'USER' });
    expect(me.json().user.impersonatedBy).toBeTruthy();
    expect((await call('GET', '/internal/admin/system', asCustomer)).statusCode).toBe(403);

    const stop = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/admin/stop-impersonating',
      headers: { cookie: asCustomer, origin: APP_URL },
    });
    expect(stop.statusCode).toBe(200);
    const back = applyCookies(asCustomer, stop.headers['set-cookie']);
    const meAgain = await call('GET', '/internal/me', back);
    expect(meAgain.json().user).toMatchObject({ email: 'admin@example.com', impersonatedBy: null });

    const trail = await ctx.prisma.auditLog.findMany({
      where: { action: { startsWith: 'impersonate.' } },
      orderBy: { createdAt: 'asc' },
    });
    expect(trail.map((a) => [a.action, a.target])).toEqual([
      ['impersonate.start', customer.id],
      ['impersonate.stop', customer.id],
    ]);
  });

  it('manages global packages shown in the customer top-up', async () => {
    const created = await call('POST', '/internal/admin/packages', admin, {
      name: 'Pacote 50',
      priceCents: 5000,
      creditMicros: '50000000',
      bonusMicros: '5000000',
      highlight: true,
      active: true,
      sortOrder: 1,
    });
    expect(created.statusCode).toBe(201);
    const id = created.json().id;
    await call('PATCH', `/internal/admin/packages/${id}`, admin, { name: 'Pacote Turbo' });
    const options = await call('GET', `/internal/organizations/${orgId}/topup-options`, owner);
    expect(options.json().packages).toEqual([
      expect.objectContaining({ id, name: 'Pacote Turbo', bonusMicros: '5000000' }),
    ]);
    const removed = await call('DELETE', `/internal/admin/packages/${id}`, admin);
    expect(removed.json()).toMatchObject({ deleted: true });
    expect((await call('GET', '/internal/admin/packages', admin)).json().packages).toEqual([]);
  });

  it('explores usage across customers with filters', async () => {
    const { provider } = await seedUsage();
    const all = await call('GET', '/internal/admin/usage', admin);
    expect(all.json().items).toHaveLength(3);
    expect(all.json().items[0]).toMatchObject({ org: { id: orgId, name: 'Cliente Um' } });
    const errors = await call(
      'GET',
      `/internal/admin/usage?status=UPSTREAM_ERROR&providerId=${provider.id}`,
      admin,
    );
    expect(errors.json().items).toEqual([
      expect.objectContaining({ requestId: 'req-3', provider: 'DeepSeek' }),
    ]);
    const byRequest = await call('GET', '/internal/admin/usage?requestId=req-2', admin);
    expect(byRequest.json().items[0]).toMatchObject({
      costMicros: '150000',
      chargedMicros: '600000',
    });
  });

  it('lists inbound webhooks and reprocesses one through the queue', async () => {
    const event = await ctx.prisma.inboundWebhookEvent.create({
      data: {
        provider: 'asaas',
        eventKey: 'evt-1',
        type: 'PAYMENT_RECEIVED',
        payload: { kind: 'paid', providerPaymentId: 'pay_1', valueCents: 1000, raw: { x: 1 } },
        processedAt: new Date(),
        error: 'payment_not_found',
      },
    });
    const list = await call('GET', '/internal/admin/webhook-events?state=error', admin);
    expect(list.json().items[0]).toMatchObject({
      id: event.id,
      error: 'payment_not_found',
      summary: { kind: 'paid', providerPaymentId: 'pay_1', valueCents: 1000 },
    });
    expect(list.json().items[0].payload).toBeUndefined();

    const again = await call('POST', `/internal/admin/webhook-events/${event.id}/reprocess`, admin);
    expect(again.json()).toEqual({ queued: true });
    expect(ctx.jobs.jobs).toContainEqual({ name: 'process-webhook', data: { eventId: event.id } });
    const reset = await ctx.prisma.inboundWebhookEvent.findUniqueOrThrow({
      where: { id: event.id },
    });
    expect(reset).toMatchObject({ processedAt: null, error: null });
  });

  it('reports system status', async () => {
    const res = await call('GET', '/internal/admin/system', admin);
    expect(res.json()).toMatchObject({
      database: { ok: true },
      redis: { ok: true },
      queue: { waiting: 0 },
      pendingInboundWebhooks: 0,
    });
    expect(res.json().lastMigration).toMatch(/^[0-9]{14}_/);
  });
});
