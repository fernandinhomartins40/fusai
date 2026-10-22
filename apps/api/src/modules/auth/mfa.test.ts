import { createHmac } from 'node:crypto';
import { decryptOAuthToken, setTokenUtil } from 'better-auth/oauth2';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  APP_URL,
  cookieHeader,
  createTestApp,
  resetDb,
  signIn,
  signUp,
} from '../../../test/helpers';
import { createAuth } from './auth';
import { LOGIN_MAX_FAILURES } from './login-throttle';

/** RFC 6238 TOTP (SHA-1, 6 digits, 30 s), the same an authenticator app computes. */
function totp(uri: string, at = Date.now()): string {
  const secret = new URL(uri).searchParams.get('secret') ?? '';
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const ch of secret.replace(/=+$/, '').toUpperCase())
    bits += alphabet.indexOf(ch).toString(2).padStart(5, '0');
  const key = Buffer.from(bits.match(/.{8}/g)?.map((b) => Number.parseInt(b, 2)) ?? []);
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 30_000)));
  const hmac = createHmac('sha1', key).update(counter).digest();
  const offset = (hmac.at(-1) ?? 0) & 0xf;
  const code = (hmac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return code.toString().padStart(6, '0');
}

describe('PIE S-05: two-factor (TOTP)', () => {
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

  const post = (url: string, cookie: string, payload: unknown) =>
    ctx.app.inject({
      method: 'POST',
      url,
      headers: { origin: APP_URL, cookie },
      payload: payload as Record<string, unknown>,
    });
  const overview = (cookie: string) =>
    ctx.app.inject({ method: 'GET', url: '/internal/admin/overview', headers: { cookie } });

  async function verifiedUser(email: string, role: 'USER' | 'SUPER_ADMIN') {
    await signUp(ctx.app, email);
    await ctx.prisma.user.update({ where: { email }, data: { emailVerified: true, role } });
    return (await signIn(ctx.app, email)).cookie;
  }

  /** Turns on the authenticator for a signed-in user; returns the new cookie and the URI. */
  async function enroll(cookie: string) {
    const enabled = await post('/api/auth/two-factor/enable', cookie, {
      password: 'Senha-Forte-123',
    });
    expect(enabled.statusCode).toBe(200);
    const { totpURI, backupCodes } = enabled.json() as { totpURI: string; backupCodes: string[] };
    expect(totpURI).toMatch(/^otpauth:\/\/totp\/fusai/);
    expect(backupCodes.length).toBeGreaterThan(0);
    const verified = await post('/api/auth/two-factor/verify-totp', cookie, {
      code: totp(totpURI),
    });
    expect(verified.statusCode).toBe(200);
    return { cookie: cookieHeader(verified.headers['set-cookie']), totpURI, backupCodes };
  }

  it('keeps the admin panel closed until the super admin confirms the authenticator', async () => {
    const email = 'root@example.com';
    const cookie = await verifiedUser(email, 'SUPER_ADMIN');

    const blocked = await overview(cookie);
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json().error.code).toBe('mfa_required');
    // Better Auth's own admin endpoints are closed too (ban, impersonate, sessions).
    const listUsers = await ctx.app.inject({
      method: 'GET',
      url: '/api/auth/admin/list-users',
      headers: { origin: APP_URL, cookie },
    });
    expect(listUsers.statusCode).toBe(403);

    const me = await ctx.app.inject({ method: 'GET', url: '/internal/me', headers: { cookie } });
    expect(me.json().user).toMatchObject({ twoFactorEnabled: false, mfaVerified: false });

    const enrolled = await enroll(cookie);
    expect((await overview(enrolled.cookie)).statusCode).toBe(200);
    const secret = await ctx.prisma.twoFactor.findFirstOrThrow({ where: { user: { email } } });
    expect(secret.secret).not.toContain(new URL(enrolled.totpURI).searchParams.get('secret'));

    // A session opened without the code (e.g. Google sign-in) confirms it while signed in.
    await ctx.prisma.session.updateMany({
      where: { user: { email } },
      data: { mfaVerifiedAt: null },
    });
    expect((await overview(enrolled.cookie)).statusCode).toBe(403);
    const stepUp = await post('/api/auth/two-factor/verify-totp', enrolled.cookie, {
      code: totp(enrolled.totpURI),
    });
    expect(stepUp.statusCode).toBe(200);
    expect((await overview(enrolled.cookie)).statusCode).toBe(200);

    // Next password sign-in stops at the code: no session until the TOTP is right.
    const first = await signIn(ctx.app, email);
    expect(first.res.json()).toMatchObject({ twoFactorRedirect: true });
    expect(first.cookie).not.toMatch(/session_token=[^;]+/);
    const wrong = await post('/api/auth/two-factor/verify-totp', first.cookie, { code: '000000' });
    expect(wrong.statusCode).toBe(401);
    const second = await signIn(ctx.app, email);
    const ok = await post('/api/auth/two-factor/verify-totp', second.cookie, {
      code: totp(enrolled.totpURI),
    });
    expect(ok.statusCode).toBe(200);
    expect((await overview(cookieHeader(ok.headers['set-cookie']))).statusCode).toBe(200);

    // A backup code also opens the panel.
    const third = await signIn(ctx.app, email);
    const backup = await post('/api/auth/two-factor/verify-backup-code', third.cookie, {
      code: enrolled.backupCodes[0],
    });
    expect(backup.statusCode).toBe(200);
    expect((await overview(cookieHeader(backup.headers['set-cookie']))).statusCode).toBe(200);
  });

  it('is optional for customers and asks for the code once turned on', async () => {
    const email = 'cliente-2fa@example.com';
    const cookie = await verifiedUser(email, 'USER');
    const me = await ctx.app.inject({ method: 'GET', url: '/internal/me', headers: { cookie } });
    expect(me.statusCode).toBe(200); // no 2FA required to use the dashboard

    const enrolled = await enroll(cookie);
    const meAfter = await ctx.app.inject({
      method: 'GET',
      url: '/internal/me',
      headers: { cookie: enrolled.cookie },
    });
    expect(meAfter.json().user).toMatchObject({ twoFactorEnabled: true, mfaVerified: true });
    expect((await signIn(ctx.app, email)).res.json()).toMatchObject({ twoFactorRedirect: true });
    // Still not an admin.
    expect((await overview(enrolled.cookie)).statusCode).toBe(403);
  });

  it('asks any account with 2FA for the code after a sign-in that skipped it (Google)', async () => {
    const email = 'google-2fa@example.com';
    const cookie = await verifiedUser(email, 'USER');
    const deletion = (c: string) =>
      ctx.app.inject({ method: 'GET', url: '/internal/privacy/deletion', headers: { cookie: c } });
    // Without 2FA a session that never saw a code works normally (plain Google sign-in).
    expect((await deletion(cookie)).statusCode).toBe(200);

    const enrolled = await enroll(cookie);
    expect((await deletion(enrolled.cookie)).statusCode).toBe(200);

    // Google sign-in creates the session without the code.
    await ctx.prisma.session.updateMany({
      where: { user: { email } },
      data: { mfaVerifiedAt: null },
    });
    const blocked = await deletion(enrolled.cookie);
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json().error.code).toBe('mfa_required');
    // The web app still learns it must ask for the code.
    const me = await ctx.app.inject({
      method: 'GET',
      url: '/internal/me',
      headers: { cookie: enrolled.cookie },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json().user).toMatchObject({ twoFactorEnabled: true, mfaVerified: false });

    const stepUp = await post('/api/auth/two-factor/verify-totp', enrolled.cookie, {
      code: totp(enrolled.totpURI),
    });
    expect(stepUp.statusCode).toBe(200);
    expect((await deletion(enrolled.cookie)).statusCode).toBe(200);
  });

  it('emails the account owner once when password sign-in gets locked', async () => {
    const email = 'alvo@example.com';
    await verifiedUser(email, 'USER');
    ctx.mailer.sent.length = 0;
    for (let i = 0; i < LOGIN_MAX_FAILURES + 2; i++) await signIn(ctx.app, email, 'Errada-123456');
    // Sign-up sends its confirmation email in the background: look only at lock emails.
    const lockEmails = () =>
      ctx.mailer.sent.filter((m) => m.subject.includes('Tentativas de acesso'));
    const locked = lockEmails();
    expect(locked).toHaveLength(1);
    expect(locked[0]?.to).toBe(email);

    // Unknown emails get no message (and nothing reveals whether they exist).
    ctx.mailer.sent.length = 0;
    for (let i = 0; i < LOGIN_MAX_FAILURES; i++)
      await signIn(ctx.app, 'ninguem@example.com', 'Errada-123456');
    expect(lockEmails()).toHaveLength(0);
  });
});

describe('PIE S-16: OAuth tokens at rest', () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(async () => {
    await ctx.app.close();
  });
  beforeEach(async () => {
    await resetDb();
  });

  it('encrypts new tokens, still reads old plaintext ones and never stores the id_token', async () => {
    const auth = createAuth(ctx.env, ctx.prisma, ctx.mailer, ctx.redis);
    const authCtx = await auth.$context;
    // Same context Better Auth passes to these helpers; its generic options type is narrower.
    const tokenCtx = authCtx as unknown as Parameters<typeof setTokenUtil>[1];

    // What Better Auth writes on a Google sign-in (setTokenUtil) and reads back.
    const plain = 'ya29.access-token-de-teste';
    const stored = await setTokenUtil(plain, tokenCtx);
    expect(stored).not.toContain(plain);
    expect(await decryptOAuthToken(stored as string, tokenCtx)).toBe(plain);
    // Tokens saved before this change stay readable.
    expect(await decryptOAuthToken('ya29.token-antigo', tokenCtx)).toBe('ya29.token-antigo');

    await signUp(ctx.app, 'google@example.com');
    const user = await ctx.prisma.user.findUniqueOrThrow({
      where: { email: 'google@example.com' },
    });
    const account = await authCtx.internalAdapter.createAccount({
      userId: user.id,
      providerId: 'google',
      accountId: 'google-123',
      accessToken: stored as string,
      idToken: 'eyJ.id-token.com-nome-e-email',
    });
    const row = await ctx.prisma.account.findUniqueOrThrow({ where: { id: account.id } });
    expect(row.idToken).toBeNull();
    expect(row.accessToken).not.toContain(plain);

    await authCtx.internalAdapter.updateAccount(account.id, { idToken: 'eyJ.novo' });
    expect(
      (await ctx.prisma.account.findUniqueOrThrow({ where: { id: account.id } })).idToken,
    ).toBeNull();
  });
});
