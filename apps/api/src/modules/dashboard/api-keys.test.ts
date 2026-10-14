import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { APP_URL, createTestApp, createUserSession, resetDb } from '../../../test/helpers';
import { hashApiKey } from '../api-keys/keys';

describe('dashboard: API keys', () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let owner: string;
  let projectId: string;

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(async () => {
    await ctx.app.close();
  });
  beforeEach(async () => {
    await resetDb();
    owner = await createUserSession(ctx.app, 'dono@example.com');
    const org = (
      await call('POST', '/internal/onboarding/organization', owner, {
        name: 'Org',
        document: '52998224725',
        phone: '11999990000',
      })
    ).json();
    projectId = (
      await call('POST', `/internal/organizations/${org.id}/projects`, owner, { name: 'App' })
    ).json().id;
  });

  const call = (method: 'GET' | 'POST' | 'PATCH', url: string, cookie: string, payload?: object) =>
    ctx.app.inject({ method, url, payload, headers: { cookie, origin: APP_URL } });

  it('shows the full key once and stores only its peppered hash', async () => {
    const res = await call('POST', `/internal/projects/${projectId}/api-keys`, owner, {
      name: 'Produção',
    });
    expect(res.statusCode).toBe(201);
    const created = res.json();
    expect(created.key).toMatch(/^fai_live_[0-9A-Za-z]{40}$/);
    expect(created).toMatchObject({
      name: 'Produção',
      env: 'LIVE',
      prefix: created.key.slice(0, 12),
      scopes: ['chat', 'billing:read', 'checkout', 'app_users', 'mcp'],
    });

    const row = await ctx.prisma.apiKey.findUniqueOrThrow({ where: { id: created.id } });
    expect(row.hash).toBe(hashApiKey(created.key, ctx.env.KEY_PEPPER));
    expect(JSON.stringify(row)).not.toContain(created.key);

    const list = await call('GET', `/internal/projects/${projectId}/api-keys`, owner);
    expect(list.body).not.toContain(created.key);
    expect(list.body).not.toContain(row.hash);
    expect(list.json().keys).toHaveLength(1);

    const audit = await ctx.prisma.auditLog.findFirstOrThrow({
      where: { action: 'api_key.create' },
    });
    expect(JSON.stringify(audit)).not.toContain(created.key);
  });

  it('creates test keys, updates limits and revokes', async () => {
    const created = (
      await call('POST', `/internal/projects/${projectId}/api-keys`, owner, {
        name: 'Teste',
        env: 'TEST',
        scopes: ['chat'],
        rpmLimit: 30,
      })
    ).json();
    expect(created.key.startsWith('fai_test_')).toBe(true);

    const updated = await call('PATCH', `/internal/api-keys/${created.id}`, owner, {
      spendLimitMicros: '5000000',
    });
    expect(updated.json()).toMatchObject({
      spendLimitMicros: '5000000',
      rpmLimit: 30,
      scopes: ['chat'],
    });

    const revoked = await call('POST', `/internal/api-keys/${created.id}/revoke`, owner);
    expect(revoked.json().revokedAt).toBeTruthy();
  });

  it('hides keys of other organizations', async () => {
    const created = (
      await call('POST', `/internal/projects/${projectId}/api-keys`, owner, { name: 'X' })
    ).json();
    const stranger = await createUserSession(ctx.app, 'outro@example.com');
    expect(
      (await call('GET', `/internal/projects/${projectId}/api-keys`, stranger)).statusCode,
    ).toBe(404);
    expect(
      (await call('POST', `/internal/api-keys/${created.id}/revoke`, stranger)).statusCode,
    ).toBe(404);
    expect(
      (
        await call('POST', `/internal/projects/${projectId}/api-keys`, stranger, {
          name: 'invasão',
        })
      ).statusCode,
    ).toBe(404);
  });

  it('a key created in the dashboard works on the gateway', async () => {
    const created = (
      await call('POST', `/internal/projects/${projectId}/api-keys`, owner, { name: 'gw' })
    ).json();
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/v1/models',
      headers: { authorization: `Bearer ${created.key}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ object: 'list', data: [] });

    await call('POST', `/internal/api-keys/${created.id}/revoke`, owner);
    const after = await ctx.app.inject({
      method: 'GET',
      url: '/v1/models',
      headers: { authorization: `Bearer ${created.key}` },
    });
    expect(after.statusCode).toBe(401);
  });
});
