import { hashPassword } from 'better-auth/crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  APP_URL,
  cookieHeader,
  createTestApp,
  resetDb,
  signIn,
  signUp,
} from '../../../test/helpers';

describe('auth flow', () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(async () => {
    await ctx.app.close();
  });
  beforeEach(async () => {
    await resetDb();
    ctx.mailer.sent.length = 0;
  });

  it('signs up, requires email verification, then signs in', async () => {
    const email = 'cliente@example.com';
    const res = await signUp(ctx.app, email);
    expect(res.statusCode).toBe(200);

    // Unverified users cannot sign in.
    const blocked = await signIn(ctx.app, email);
    expect(blocked.res.statusCode).toBe(403);

    const mail = ctx.mailer.sent.find((m) => m.subject.includes('Confirme'));
    expect(mail?.to).toBe(email);
    const link = mail?.text.match(/https?:\/\/\S+/)?.[0];
    expect(link).toBeTruthy();

    const verify = await ctx.app.inject({
      method: 'GET',
      url: new URL(link as string).pathname + new URL(link as string).search,
    });
    expect(verify.statusCode).toBe(302);
    expect(verify.headers.location).toBe(`${APP_URL}/app`);

    // Auto sign-in after verification sets a session cookie.
    const cookie = cookieHeader(verify.headers['set-cookie']);
    const me = await ctx.app.inject({ method: 'GET', url: '/internal/me', headers: { cookie } });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({ user: { email, role: 'USER' }, organizations: [] });

    const ok = await signIn(ctx.app, email);
    expect(ok.res.statusCode).toBe(200);
  });

  it('never lets the client set its own role', async () => {
    await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/sign-up/email',
      headers: { origin: APP_URL },
      payload: {
        name: 'X',
        email: 'hacker@example.com',
        password: 'senha-forte-123',
        role: 'SUPER_ADMIN',
      },
    });
    const user = await ctx.prisma.user.findUnique({ where: { email: 'hacker@example.com' } });
    expect(user?.role ?? 'USER').toBe('USER');
  });

  it('sends a password reset email and resets the password', async () => {
    const email = 'reset@example.com';
    await signUp(ctx.app, email);
    await ctx.prisma.user.update({ where: { email }, data: { emailVerified: true } });

    const req = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/request-password-reset',
      headers: { origin: APP_URL },
      payload: { email, redirectTo: `${APP_URL}/redefinir-senha` },
    });
    expect(req.statusCode).toBe(200);
    const link = ctx.mailer.sent
      .find((m) => m.subject.includes('senha'))
      ?.text.match(/https?:\/\/\S+/)?.[0];
    expect(link).toBeTruthy();

    const redirect = await ctx.app.inject({
      method: 'GET',
      url: new URL(link as string).pathname + new URL(link as string).search,
    });
    const location = new URL(redirect.headers.location as string);
    const token = location.searchParams.get('token');
    expect(location.pathname).toBe('/redefinir-senha');
    expect(token).toBeTruthy();

    const reset = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/reset-password',
      headers: { origin: APP_URL },
      payload: { newPassword: 'nova-senha-456', token },
    });
    expect(reset.statusCode).toBe(200);
    expect((await signIn(ctx.app, email, 'nova-senha-456')).res.statusCode).toBe(200);
  });

  it('email links always lead back to the site, even without callbackURL', async () => {
    // Sign-up without callbackURL (API clients, sign-in resend): the link still redirects to the
    // site's confirmation page instead of showing raw JSON.
    const email = 'semcallback@example.com';
    await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/sign-up/email',
      headers: { origin: APP_URL },
      payload: { name: 'Sem Callback', email, password: 'senha-forte-123' },
    });
    const verifyLink = ctx.mailer.sent
      .filter((m) => m.to === email)
      .at(-1)
      ?.text.match(/https?:\/\/\S+/)?.[0] as string;
    expect(new URL(verifyLink).searchParams.get('callbackURL')).toBe(
      `${APP_URL}/verificar-email?confirmado=1`,
    );
    const verified = await ctx.app.inject({
      method: 'GET',
      url: new URL(verifyLink).pathname + new URL(verifyLink).search,
    });
    expect(verified.statusCode).toBe(302);
    expect(verified.headers.location).toBe(`${APP_URL}/verificar-email?confirmado=1`);

    // A tampered token goes to the same page with ?error=..., which shows "Link inválido".
    const bad = new URL(verifyLink);
    bad.searchParams.set('token', 'token-invalido');
    const invalid = await ctx.app.inject({ method: 'GET', url: bad.pathname + bad.search });
    expect(invalid.statusCode).toBe(302);
    const loc = new URL(invalid.headers.location as string);
    expect(loc.pathname).toBe('/verificar-email');
    expect(loc.searchParams.get('error')).toBeTruthy();

    // Password reset without redirectTo: the link opens the site's "new password" page.
    await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/request-password-reset',
      headers: { origin: APP_URL },
      payload: { email },
    });
    const resetLink = ctx.mailer.sent
      .filter((m) => m.to === email && m.subject.includes('senha'))
      .at(-1)
      ?.text.match(/https?:\/\/\S+/)?.[0] as string;
    const reset = await ctx.app.inject({
      method: 'GET',
      url: new URL(resetLink).pathname + new URL(resetLink).search,
    });
    const target = new URL(reset.headers.location as string);
    expect(`${target.origin}${target.pathname}`).toBe(`${APP_URL}/redefinir-senha`);
    expect(target.searchParams.get('token')).toBeTruthy();
  });

  it('restricts admin routes to SUPER_ADMIN', async () => {
    const userEmail = 'comum@example.com';
    await signUp(ctx.app, userEmail);
    await ctx.prisma.user.update({ where: { email: userEmail }, data: { emailVerified: true } });
    const user = await signIn(ctx.app, userEmail);

    const denied = await ctx.app.inject({
      method: 'GET',
      url: '/internal/admin/overview',
      headers: { cookie: user.cookie },
    });
    expect(denied.statusCode).toBe(403);

    const anonymous = await ctx.app.inject({ method: 'GET', url: '/internal/admin/overview' });
    expect(anonymous.statusCode).toBe(401);

    const adminId = 'admin-test';
    await ctx.prisma.user.create({
      data: {
        id: adminId,
        name: 'Admin',
        email: 'admin@example.com',
        emailVerified: true,
        role: 'SUPER_ADMIN',
        accounts: {
          create: {
            id: 'acc-admin',
            accountId: adminId,
            providerId: 'credential',
            password: await hashPassword('senha-admin-123'),
          },
        },
      },
    });
    const admin = await signIn(ctx.app, 'admin@example.com', 'senha-admin-123');
    const allowed = await ctx.app.inject({
      method: 'GET',
      url: '/internal/admin/overview',
      headers: { cookie: admin.cookie },
    });
    expect(allowed.statusCode).toBe(200);
    expect(allowed.json()).toMatchObject({ users: 2 });
  });
});
