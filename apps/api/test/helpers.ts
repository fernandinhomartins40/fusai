import { randomUUID } from 'node:crypto';
import { prisma } from '@fusai/db';
import { buildApp } from '../src/app';
import { testEnv } from '../src/lib/env';
import { createMemoryJobQueue } from '../src/lib/jobs';
import { createMemoryMailer } from '../src/lib/mailer';
import { createRedis } from '../src/lib/redis';
import { createPaymentProvider } from '../src/payments';

export const APP_URL = 'http://localhost:3000';

/** Truncates every application table (keeps the migrations table). */
export async function resetDb() {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (tables.length === 0) return;
  const list = tables.map((t) => `"public"."${t.tablename}"`).join(', ');
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}

/** Organization with a wallet funded through the ledger (so ledger sum == balance). */
export async function createFundedOrg(
  opts: {
    balanceMicros?: bigint;
    billingType?: 'PREPAID' | 'POSTPAID' | 'INTERNAL';
    creditLimitMicros?: bigint;
    slug?: string;
  } = {},
) {
  const org = await prisma.organization.create({
    data: {
      name: 'Org Teste',
      slug: opts.slug ?? `org-${Math.random().toString(36).slice(2, 10)}`,
      billingType: opts.billingType ?? 'PREPAID',
      creditLimitMicros: opts.creditLimitMicros ?? 0n,
      wallet: { create: { ownerType: 'ORGANIZATION' } },
    },
    include: { wallet: true },
  });
  const wallet = org.wallet;
  if (!wallet) throw new Error('wallet not created');
  if (opts.balanceMicros) {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`UPDATE "Wallet" SET "balanceMicros" = ${opts.balanceMicros} WHERE id = ${wallet.id}`;
      await tx.ledgerEntry.create({
        data: {
          walletId: wallet.id,
          type: 'ADJUSTMENT',
          amountMicros: opts.balanceMicros as bigint,
          balanceAfter: opts.balanceMicros as bigint,
          description: 'saldo inicial de teste',
        },
      });
    });
  }
  return { org, walletId: wallet.id };
}

export async function createTestApp(opts: { env?: Partial<NodeJS.ProcessEnv> } = {}) {
  const mailer = createMemoryMailer();
  const env = testEnv({ APP_URL, ...opts.env });
  // Unique key prefix per app: test files never see each other's rate limits or breakers.
  const redis = createRedis(env.REDIS_URL, `test:${randomUUID()}:`);
  const jobs = createMemoryJobQueue();
  const provider = createPaymentProvider(env);
  const app = await buildApp(env, { prisma, mailer, redis, jobs, provider });
  app.addHook('onClose', async () => void (await redis.quit()));
  return { app, mailer, prisma, redis, env, jobs, provider };
}

type TestApp = Awaited<ReturnType<typeof createTestApp>>['app'];

/** Extracts "name=value" pairs from Set-Cookie headers into a Cookie header. */
export function cookieHeader(setCookie: string | string[] | undefined): string {
  const list = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  return list.map((c) => c.split(';')[0]).join('; ');
}

export async function signUp(app: TestApp, email: string, password = 'Senha-Forte-123') {
  return app.inject({
    method: 'POST',
    url: '/api/auth/sign-up/email',
    headers: { origin: APP_URL },
    payload: { name: 'Cliente Teste', email, password, callbackURL: `${APP_URL}/app` },
  });
}

/** Creates a verified user (optionally SUPER_ADMIN) and returns its session cookie. */
export async function createUserSession(
  app: TestApp,
  email: string,
  role: 'USER' | 'SUPER_ADMIN' = 'USER',
) {
  await signUp(app, email);
  await prisma.user.update({ where: { email }, data: { emailVerified: true, role } });
  const { cookie } = await signIn(app, email);
  // Super admins need a TOTP-confirmed session for /admin (PIE S-05); the real TOTP flow is
  // covered in auth/mfa.test.ts, so other suites start from an already confirmed session.
  if (role === 'SUPER_ADMIN')
    await prisma.session.updateMany({
      where: { user: { email } },
      data: { mfaVerifiedAt: new Date() },
    });
  return cookie;
}

export async function signIn(app: TestApp, email: string, password = 'Senha-Forte-123') {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/sign-in/email',
    headers: { origin: APP_URL },
    payload: { email, password },
  });
  return { res, cookie: cookieHeader(res.headers['set-cookie']) };
}
