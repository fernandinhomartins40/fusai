import type { PrismaClient } from '@fusai/db';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, passwordProblem } from '@fusai/shared';
import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { APIError, createAuthMiddleware, getSessionFromCtx } from 'better-auth/api';
import { admin } from 'better-auth/plugins/admin';
import { defaultAc } from 'better-auth/plugins/admin/access';
import { twoFactor } from 'better-auth/plugins/two-factor';
import {
  accountLockedEmail,
  resetPasswordEmail,
  verificationEmail,
} from '../../lib/email-templates';
import type { Env } from '../../lib/env';
import type { Mailer } from '../../lib/mailer';
import { betterAuthRateLimitStorage } from '../../lib/rate-limit';
import type { RedisClient } from '../../lib/redis';
import { LOGIN_MAX_FAILURES, loginThrottle } from './login-throttle';

/**
 * E-mail links hit the API (Better Auth), which only redirects back to the site when the link
 * carries `callbackURL`. Without it the user lands on raw JSON. Requests that do not pass one
 * (sign-in resend, API clients, old links) get the right page of the web app as the default.
 */
export function withCallback(url: string, fallback: string): string {
  const link = new URL(url);
  // Better Auth puts `callbackURL=/` when none is given: relative to the API host, i.e. raw JSON.
  // Only an absolute URL (already checked against trustedOrigins) is kept.
  const current = link.searchParams.get('callbackURL') ?? '';
  if (!/^https?:\/\//i.test(current)) link.searchParams.set('callbackURL', fallback);
  return link.toString();
}

/**
 * Super admin powers inside Better Auth (admin plugin): only what the panel uses — find users,
 * ban, revoke sessions and "entrar como cliente". No role/email/password changes from here.
 */
const superAdminRole = defaultAc.newRole({
  user: ['list', 'get', 'ban', 'impersonate'],
  session: ['list', 'revoke'],
});
const userRole = defaultAc.newRole({ user: [], session: [] });

/** Impersonation lasts at most 1 hour; the admin's own session comes back on "Sair do modo cliente". */
export const IMPERSONATION_SECONDS = 60 * 60;

/** Paths that prove the TOTP (or a backup code) for the session they create or reuse. */
const MFA_PROOF_PATHS = new Set(['/two-factor/verify-totp', '/two-factor/verify-backup-code']);

/** App name shown in the authenticator app. */
export const TOTP_ISSUER = 'fusai';

function clientIp(headers: Headers | undefined): string | null {
  const forwarded = headers?.get('x-forwarded-for')?.split(',')[0]?.trim();
  return forwarded || headers?.get('x-real-ip') || null;
}

export function createAuth(env: Env, prisma: PrismaClient, mailer: Mailer, redis: RedisClient) {
  const isProd = env.NODE_ENV === 'production';
  const google =
    env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
      ? { google: { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET } }
      : undefined;
  const throttle = loginThrottle(redis);
  const signInEmail = (body: unknown) => {
    const email = (body as { email?: unknown } | undefined)?.email;
    return typeof email === 'string' ? email : null;
  };

  /** Tells a real account owner that password sign-in is locked; unknown emails get nothing. */
  async function notifyLocked(email: string) {
    const user = await prisma.user.findUnique({
      where: { email: email.trim().toLowerCase() },
      select: { email: true, name: true },
    });
    if (!user) return;
    await mailer
      .send(accountLockedEmail(user.email, user.name, `${env.APP_URL}/recuperar-senha`))
      .catch(() => {}); // the lock itself must not fail because of email
  }

  return betterAuth({
    appName: 'fusai',
    baseURL: env.BETTER_AUTH_URL,
    basePath: '/api/auth',
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: [env.APP_URL],
    /**
     * "Manter conectado": signIn.email({ rememberMe: true }) gets a persistent 30-day cookie,
     * renewed daily while in use. With rememberMe false, Better Auth sets a browser-session
     * cookie (gone when the browser closes) and the server session ends within a day.
     */
    session: {
      expiresIn: 60 * 60 * 24 * 30,
      updateAge: 60 * 60 * 24,
      additionalFields: {
        // Set only by the TOTP check above; never by the client.
        mfaVerifiedAt: { type: 'date', required: false, input: false },
      },
    },
    account: {
      // PIE S-16: OAuth access/refresh tokens encrypted at rest. Older plaintext Google tokens
      // stay readable (Better Auth only decrypts values that look encrypted).
      encryptOAuthTokens: true,
    },
    databaseHooks: {
      // The app never uses the Google id_token, which carries name and email: not stored (LGPD).
      account: {
        create: { before: async (account) => ({ data: { ...account, idToken: null } }) },
        update: {
          before: async (account) =>
            'idToken' in account ? { data: { ...account, idToken: null } } : undefined,
        },
      },
    },
    hooks: {
      // Strong password enforced on the server too (the web form shows the same rules live).
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path === '/sign-in/email') {
          const email = signInEmail(ctx.body);
          if (email && (await throttle.isLocked(email)))
            throw new APIError('TOO_MANY_REQUESTS', {
              message: 'Muitas tentativas para esta conta. Aguarde 15 minutos ou redefina a senha.',
              code: 'ACCOUNT_TEMPORARILY_LOCKED',
            });
        }
        // PIE S-05: Better Auth's own admin endpoints (ban, impersonate, sessions) need the same
        // second factor as the /internal/admin routes. Leaving impersonation is always allowed.
        if (ctx.path.startsWith('/admin/') && ctx.path !== '/admin/stop-impersonating') {
          const current = await getSessionFromCtx(ctx).catch(() => null);
          const mfaVerifiedAt = (current?.session as { mfaVerifiedAt?: Date | null } | undefined)
            ?.mfaVerifiedAt;
          if (
            (current?.user as { role?: string } | undefined)?.role === 'SUPER_ADMIN' &&
            !mfaVerifiedAt
          )
            throw new APIError('FORBIDDEN', {
              message: 'Confirme a verificação em duas etapas para usar o painel admin.',
              code: 'MFA_REQUIRED',
            });
        }
        const field =
          ctx.path === '/sign-up/email'
            ? 'password'
            : ctx.path === '/reset-password' || ctx.path === '/change-password'
              ? 'newPassword'
              : null;
        if (field) {
          const value = (ctx.body as Record<string, unknown> | undefined)?.[field];
          const problem = typeof value === 'string' ? passwordProblem(value) : null;
          if (problem)
            throw new APIError('BAD_REQUEST', { message: problem, code: 'WEAK_PASSWORD' });
        }
        // Audit trail: who leaves impersonation (the session still says who started it).
        if (ctx.path === '/admin/stop-impersonating') {
          const current = await getSessionFromCtx(ctx).catch(() => null);
          const by = (current?.session as { impersonatedBy?: string | null } | undefined)
            ?.impersonatedBy;
          if (current && by) {
            await prisma.auditLog.create({
              data: {
                actorId: by,
                action: 'impersonate.stop',
                target: current.user.id,
                ip: clientIp(ctx.request?.headers),
              },
            });
          }
        }
      }),
      after: createAuthMiddleware(async (ctx) => {
        if (ctx.path === '/sign-in/email') {
          const email = signInEmail(ctx.body);
          if (!email) return;
          const returned = ctx.context.returned;
          // Only wrong credentials count (not "confirme seu email" nor rate limits). Checked by
          // status, not instanceof: plugins may throw APIError from another copy of the module.
          if ((returned as { statusCode?: unknown } | undefined)?.statusCode === 401) {
            const failures = await throttle.recordFailure(email);
            // Exactly once per lock window: the counter only reaches the limit once.
            if (failures === LOGIN_MAX_FAILURES) await notifyLocked(email);
          } else if (ctx.context.newSession) await throttle.reset(email);
          return;
        }
        if (MFA_PROOF_PATHS.has(ctx.path)) {
          // Sign-in with the code creates a new session; a signed-in user confirming the code
          // (step-up, e.g. after Google sign-in) keeps the current one.
          const returned = ctx.context.returned as { token?: unknown } | undefined;
          const token =
            ctx.context.newSession?.session.token ??
            (typeof returned?.token === 'string' ? returned.token : null);
          if (token)
            await prisma.session.updateMany({
              where: { token },
              data: { mfaVerifiedAt: new Date() },
            });
          return;
        }
        if (ctx.path !== '/admin/impersonate-user') return;
        const created = ctx.context.newSession;
        const by = (created?.session as { impersonatedBy?: string | null } | undefined)
          ?.impersonatedBy;
        if (!created || !by) return;
        await prisma.auditLog.create({
          data: {
            actorId: by,
            action: 'impersonate.start',
            target: created.user.id,
            ip: clientIp(ctx.request?.headers),
          },
        });
      }),
    },
    database: prismaAdapter(prisma, { provider: 'postgresql' }),
    user: {
      additionalFields: {
        // Platform role; never settable by the client.
        role: { type: 'string', required: false, defaultValue: 'USER', input: false },
      },
    },
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      minPasswordLength: PASSWORD_MIN_LENGTH,
      maxPasswordLength: PASSWORD_MAX_LENGTH,
      resetPasswordTokenExpiresIn: 60 * 60,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }) => {
        const link = withCallback(url, `${env.APP_URL}/redefinir-senha`);
        await mailer.send(resetPasswordEmail(user.email, user.name, link));
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      sendOnSignIn: true,
      autoSignInAfterVerification: true,
      sendVerificationEmail: async ({ user, url }) => {
        const link = withCallback(url, `${env.APP_URL}/verificar-email?confirmado=1`);
        await mailer.send(verificationEmail(user.email, user.name, link));
      },
    },
    socialProviders: google,
    plugins: [
      admin({
        defaultRole: 'USER',
        adminRoles: ['SUPER_ADMIN'],
        roles: { SUPER_ADMIN: superAdminRole, USER: userRole },
        impersonationSessionDuration: IMPERSONATION_SECONDS,
        bannedUserMessage: 'Sua conta está bloqueada. Fale com o suporte da fusai.',
      }),
      // PIE S-05: TOTP with an authenticator app. Mandatory for SUPER_ADMIN (see the guards),
      // optional for customers. Secret and backup codes are stored encrypted.
      twoFactor({ issuer: TOTP_ISSUER }),
    ],
    rateLimit: {
      enabled: env.NODE_ENV !== 'test',
      // Shared across API instances (and survives restarts) via Redis.
      customStorage: betterAuthRateLimitStorage(redis),
      window: 60,
      max: 100,
      customRules: {
        '/sign-in/email': { window: 60, max: 5 },
        '/sign-up/email': { window: 60, max: 5 },
        '/request-password-reset': { window: 300, max: 3 },
        '/send-verification-email': { window: 300, max: 3 },
        // A signed-in TOTP check has no per-challenge attempt limit: cap it per IP.
        '/two-factor/verify-totp': { window: 60, max: 5 },
        '/two-factor/verify-backup-code': { window: 60, max: 5 },
      },
    },
    advanced: {
      useSecureCookies: isProd,
      defaultCookieAttributes: { httpOnly: true, sameSite: 'lax', secure: isProd },
      crossSubDomainCookies:
        env.COOKIE_DOMAIN !== 'localhost'
          ? { enabled: true, domain: env.COOKIE_DOMAIN }
          : { enabled: false },
    },
    telemetry: { enabled: false },
  });
}

export type Auth = ReturnType<typeof createAuth>;
