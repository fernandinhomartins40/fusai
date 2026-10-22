/** Ports and environment of the E2E stack. Everything is local: fake Asaas, SMTP sink, own database. */
export const PORTS = {
  web: Number(process.env.E2E_WEB_PORT ?? 3200),
  api: Number(process.env.E2E_API_PORT ?? 4210),
  asaas: Number(process.env.E2E_ASAAS_PORT ?? 4299),
  smtp: Number(process.env.E2E_SMTP_PORT ?? 2625),
};

export const WEB_URL = `http://localhost:${PORTS.web}`;
export const API_URL = `http://localhost:${PORTS.api}`;

/** Mailbox file written by the SMTP sink (see services.ts). */
export const MAIL_FILE = new URL('../.tmp/mail.txt', import.meta.url);

const databaseUrl =
  process.env.E2E_DATABASE_URL ?? 'postgresql://fuseai:fuseai@localhost:5432/fuseai_e2e';
if (!new URL(databaseUrl).pathname.endsWith('_e2e')) {
  throw new Error('E2E_DATABASE_URL must point to a database whose name ends with _e2e');
}

export const ADMIN = { email: 'admin-e2e@example.test', password: 'E2e-Admin-Senha-2026!' };

/** Test-only values: never reuse them anywhere else. */
export const stackEnv: Record<string, string> = {
  NODE_ENV: 'development',
  LOG_LEVEL: 'warn',
  DATABASE_URL: databaseUrl,
  REDIS_URL: process.env.E2E_REDIS_URL ?? 'redis://localhost:6379/3',
  PORT: String(PORTS.api),
  APP_URL: WEB_URL,
  API_URL,
  BETTER_AUTH_URL: API_URL,
  COOKIE_DOMAIN: 'localhost',
  BETTER_AUTH_SECRET: 'e2e-only-better-auth-secret-0123456789abcdef',
  ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
  KEY_PEPPER: 'e2e-only-pepper-0123',
  SESSION_TOKEN_SECRET: 'e2e-only-session-secret-0123456789abcdef',
  ASAAS_ENV: 'sandbox',
  ASAAS_API_KEY: '$aact_hmlg_e2e',
  ASAAS_API_URL: `http://localhost:${PORTS.asaas}`,
  ASAAS_WEBHOOK_TOKEN: 'e2e-only-asaas-webhook-token',
  SMTP_URL: `smtp://127.0.0.1:${PORTS.smtp}`,
  VELOMAIL_API_KEY: '',
  GOOGLE_CLIENT_ID: '',
  GOOGLE_CLIENT_SECRET: '',
  SEED_ADMIN_EMAIL: ADMIN.email,
  SEED_ADMIN_PASSWORD: ADMIN.password,
  NEXT_PUBLIC_API_URL: API_URL,
  NEXT_PUBLIC_APP_URL: WEB_URL,
  INTERNAL_API_URL: API_URL,
  NEXT_TELEMETRY_DISABLED: '1',
};
