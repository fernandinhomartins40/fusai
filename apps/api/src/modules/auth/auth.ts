import type { PrismaClient } from '@fusai/db';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, passwordProblem } from '@fusai/shared';
import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { APIError, createAuthMiddleware, getSessionFromCtx } from 'better-auth/api';
import { admin } from 'better-auth/plugins/admin';
import { defaultAc } from 'better-auth/plugins/admin/access';
import { resetPasswordEmail, verificationEmail } from '../../lib/email-templates';
import type { Env } from '../../lib/env';
import type { Mailer } from '../../lib/mailer';
import { betterAuthRateLimitStorage } from '../../lib/rate-limit';
import type { RedisClient } from '../../lib/redis';

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
    },
    hooks: {
      // Strong password enforced on the server too (the web form shows the same rules live).
      before: createAuthMiddleware(async (ctx) => {
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
