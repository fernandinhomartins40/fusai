import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { APP_URL, createTestApp, resetDb, signIn, signUp } from '../../../test/helpers';

describe('onboarding', () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let cookie: string;

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(async () => {
    await ctx.app.close();
  });
  beforeEach(async () => {
    await resetDb();
    const email = 'dono@example.com';
    await signUp(ctx.app, email);
    await ctx.prisma.user.update({ where: { email }, data: { emailVerified: true } });
    cookie = (await signIn(ctx.app, email)).cookie;
  });

  const post = (
    url: string,
    payload: Record<string, unknown>,
    headers: Record<string, string> = {},
  ) =>
    ctx.app.inject({
      method: 'POST',
      url,
      payload,
      headers: { cookie, origin: APP_URL, ...headers },
    });

  it('creates organization with wallet and owner membership, then a project', async () => {
    await ctx.prisma.setting.create({ data: { key: 'welcome_bonus_micros', value: '2000000' } });

    const res = await post('/internal/onboarding/organization', {
      name: 'Açaí & Cia',
      document: '11.222.333/0001-81',
      phone: '(11) 99999-0000',
    });
    expect(res.statusCode).toBe(201);
    const org = res.json();
    expect(org.slug).toBe('acai-cia');

    const stored = await ctx.prisma.organization.findUniqueOrThrow({
      where: { id: org.id },
      include: { wallet: { include: { entries: true } }, members: true },
    });
    expect(stored.document).toBe('11222333000181');
    expect(stored.phone).toBe('11999990000');
    expect(stored.members[0]?.role).toBe('OWNER');
    expect(stored.wallet?.balanceMicros).toBe(2_000_000n);
    expect(stored.wallet?.entries).toHaveLength(1);
    expect(stored.wallet?.entries[0]).toMatchObject({ type: 'BONUS', balanceAfter: 2_000_000n });

    const project = await post(`/internal/organizations/${org.id}/projects`, {
      name: 'Meu App',
      billingMode: 'HYBRID',
    });
    expect(project.statusCode).toBe(201);
    expect(project.json()).toMatchObject({ slug: 'meu-app', billingMode: 'HYBRID' });

    const me = await ctx.app.inject({ method: 'GET', url: '/internal/me', headers: { cookie } });
    expect(me.json().organizations[0]).toMatchObject({
      name: 'Açaí & Cia',
      role: 'OWNER',
      balanceMicros: '2000000',
      projects: [{ name: 'Meu App' }],
    });
  });

  it('rejects an invalid CPF/CNPJ', async () => {
    const res = await post('/internal/onboarding/organization', {
      name: 'Empresa',
      document: '111.111.111-11',
      phone: '11999990000',
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toBe('CPF ou CNPJ inválido');
  });

  it('blocks cross-origin mutations and other organizations', async () => {
    const csrf = await post(
      '/internal/onboarding/organization',
      { name: 'Empresa', document: '52998224725', phone: '11999990000' },
      { origin: 'https://evil.example' },
    );
    expect(csrf.statusCode).toBe(403);

    const other = await ctx.prisma.organization.create({ data: { name: 'Outra', slug: 'outra' } });
    const res = await post(`/internal/organizations/${other.id}/projects`, { name: 'Invasão' });
    expect(res.statusCode).toBe(404);
  });

  it('requires a session', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/internal/me' });
    expect(res.statusCode).toBe(401);
  });
});
