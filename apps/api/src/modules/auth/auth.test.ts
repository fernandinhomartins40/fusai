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
import { LOGIN_MAX_FAILURES } from './login-throttle';

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
        password: 'Senha-Forte-123',
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
      payload: { newPassword: 'Nova-Senha-456', token },
    });
    expect(reset.statusCode).toBe(200);
    expect((await signIn(ctx.app, email, 'Nova-Senha-456')).res.statusCode).toBe(200);
  });

  it('email links always lead back to the site, even without callbackURL', async () => {
    // Sign-up without callbackURL (API clients, sign-in resend): the link still redirects to the
    // site's confirmation page instead of showing raw JSON.
    const email = 'semcallback@example.com';
    await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/sign-up/email',
      headers: { origin: APP_URL },
      payload: { name: 'Sem Callback', email, password: 'Senha-Forte-123' },
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

  it('rejects weak passwords on the server (sign-up and reset)', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/sign-up/email',
      headers: { origin: APP_URL },
      payload: { name: 'Fraca', email: 'fraca@example.com', password: 'senhafraca123' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toMatch(/maiúscula/);
    expect(await ctx.prisma.user.count({ where: { email: 'fraca@example.com' } })).toBe(0);

    const reset = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/reset-password',
      headers: { origin: APP_URL },
      payload: { newPassword: 'curta', token: 'qualquer' },
    });
    expect(reset.statusCode).toBe(400);
    expect(reset.json().code).toBe('WEAK_PASSWORD');
  });

  it('keeps the session only for the browser session without "manter conectado"', async () => {
    await signUp(ctx.app, 'lembrar@example.com');
    await ctx.prisma.user.update({
      where: { email: 'lembrar@example.com' },
      data: { emailVerified: true },
    });
    const login = (rememberMe: boolean) =>
      ctx.app.inject({
        method: 'POST',
        url: '/api/auth/sign-in/email',
        headers: { origin: APP_URL },
        payload: { email: 'lembrar@example.com', password: 'Senha-Forte-123', rememberMe },
      });
    const sessionCookie = (r: Awaited<ReturnType<typeof login>>) =>
      ([] as string[])
        .concat(r.headers['set-cookie'] ?? [])
        .find((c) => c.includes('session_token=')) ?? '';
    const persistent = sessionCookie(await login(true));
    expect(persistent).toMatch(/Max-Age=\d+/i); // survives closing the browser (30 days)
    const browserOnly = sessionCookie(await login(false));
    expect(browserOnly).not.toMatch(/Max-Age|Expires/i); // gone when the browser closes
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
    // PIE S-05: without the authenticator confirmation the panel stays closed.
    const noMfa = await ctx.app.inject({
      method: 'GET',
      url: '/internal/admin/overview',
      headers: { cookie: admin.cookie },
    });
    expect(noMfa.statusCode).toBe(403);
    expect(noMfa.json().error.code).toBe('mfa_required');
    await ctx.prisma.session.updateMany({
      where: { userId: adminId },
      data: { mfaVerifiedAt: new Date() },
    });
    const allowed = await ctx.app.inject({
      method: 'GET',
      url: '/internal/admin/overview',
      headers: { cookie: admin.cookie },
    });
    expect(allowed.statusCode).toBe(200);
    expect(allowed.json()).toMatchObject({ users: 2 });
  });

  it('PIE S-05: caps wrong passwords per account, across IPs, temporarily', async () => {
    const email = 'alvo@example.com';
    await signUp(ctx.app, email);
    await ctx.prisma.user.update({ where: { email }, data: { emailVerified: true } });
    const attempt = (password: string, i: number) =>
      ctx.app.inject({
        method: 'POST',
        url: '/api/auth/sign-in/email',
        headers: { origin: APP_URL, 'x-forwarded-for': `203.0.113.${i % 250}` },
        payload: { email, password },
      });

    // A success before the cap clears the count.
    for (let i = 0; i < LOGIN_MAX_FAILURES - 1; i++)
      expect((await attempt('Errada-123456', i)).statusCode).toBe(401);
    expect((await signIn(ctx.app, email)).res.statusCode).toBe(200);

    for (let i = 0; i < LOGIN_MAX_FAILURES; i++)
      expect((await attempt('Errada-123456', i)).statusCode).toBe(401);
    // Locked even with the right password and a fresh IP; other accounts are not affected.
    const locked = await attempt('Senha-Forte-123', 99);
    expect(locked.statusCode).toBe(429);
    expect(locked.json()).toMatchObject({ code: 'ACCOUNT_TEMPORARILY_LOCKED' });
    expect((await signIn(ctx.app, 'ALVO@example.com')).res.statusCode).toBe(429);
    await signUp(ctx.app, 'outro@example.com');
    await ctx.prisma.user.update({
      where: { email: 'outro@example.com' },
      data: { emailVerified: true },
    });
    expect((await signIn(ctx.app, 'outro@example.com')).res.statusCode).toBe(200);
  });
});
