import { prisma } from '@fuseai/db';
import { buildApp } from '../src/app';
import { testEnv } from '../src/lib/env';
import { createMemoryMailer } from '../src/lib/mailer';

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

export async function createTestApp() {
  const mailer = createMemoryMailer();
  const app = await buildApp(testEnv({ APP_URL }), { prisma, mailer });
  return { app, mailer, prisma };
}

type TestApp = Awaited<ReturnType<typeof createTestApp>>['app'];

/** Extracts "name=value" pairs from Set-Cookie headers into a Cookie header. */
export function cookieHeader(setCookie: string | string[] | undefined): string {
  const list = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  return list.map((c) => c.split(';')[0]).join('; ');
}

export async function signUp(app: TestApp, email: string, password = 'senha-forte-123') {
  return app.inject({
    method: 'POST',
    url: '/api/auth/sign-up/email',
    headers: { origin: APP_URL },
    payload: { name: 'Cliente Teste', email, password, callbackURL: `${APP_URL}/app` },
  });
}

export async function signIn(app: TestApp, email: string, password = 'senha-forte-123') {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/sign-in/email',
    headers: { origin: APP_URL },
    payload: { email, password },
  });
  return { res, cookie: cookieHeader(res.headers['set-cookie']) };
}
