import type { PrismaClient } from '@fuseai/db';
import { PASSWORD_MIN_LENGTH } from '@fuseai/shared';
import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { resetPasswordEmail, verificationEmail } from '../../lib/email-templates';
import type { Env } from '../../lib/env';
import type { Mailer } from '../../lib/mailer';

export function createAuth(env: Env, prisma: PrismaClient, mailer: Mailer) {
  const isProd = env.NODE_ENV === 'production';
  const google =
    env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
      ? { google: { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET } }
      : undefined;

  return betterAuth({
    appName: 'FuseAI',
    baseURL: env.BETTER_AUTH_URL,
    basePath: '/api/auth',
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: [env.APP_URL],
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
      resetPasswordTokenExpiresIn: 60 * 60,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }) => {
        await mailer.send(resetPasswordEmail(user.email, user.name, url));
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      sendOnSignIn: true,
      autoSignInAfterVerification: true,
      sendVerificationEmail: async ({ user, url }) => {
        await mailer.send(verificationEmail(user.email, user.name, url));
      },
    },
    socialProviders: google,
    rateLimit: {
      enabled: env.NODE_ENV !== 'test',
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
