import { z } from 'zod';

const optional = z
  .string()
  .optional()
  .transform((v) => (v ? v : undefined));

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().positive().default(4000),
  APP_URL: z.url().default('http://localhost:3000'),
  API_URL: z.url().default('http://localhost:4000'),
  COOKIE_DOMAIN: z.string().default('localhost'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().default('redis://localhost:6379'),

  BETTER_AUTH_SECRET: z.string().min(16),
  BETTER_AUTH_URL: z.url().default('http://localhost:4000'),
  GOOGLE_CLIENT_ID: optional,
  GOOGLE_CLIENT_SECRET: optional,

  ENCRYPTION_KEY: z
    .string()
    .refine(
      (v) => Buffer.from(v, 'base64').length === 32,
      'ENCRYPTION_KEY must be 32 bytes in base64 (generate with: openssl rand -base64 32)',
    ),

  /** Mixed into API key hashes: sha256(key + KEY_PEPPER). Changing it invalidates every key. */
  KEY_PEPPER: z.string().min(8),

  ASAAS_ENV: z.enum(['sandbox', 'production']).default('sandbox'),
  ASAAS_API_KEY: optional,
  /** Overrides the base URL derived from ASAAS_ENV (tests and local fakes). */
  ASAAS_API_URL: optional,
  ASAAS_WEBHOOK_TOKEN: z.string().min(8),

  EMAIL_FROM: z.string().default('FuseAI <nao-responda@fuseai.com.br>'),
  RESEND_API_KEY: optional,
  SMTP_URL: z.string().default('smtp://localhost:1025'),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    throw new Error(`Invalid environment variables:\n${z.prettifyError(parsed.error)}`);
  }
  const env = parsed.data;
  if (env.NODE_ENV === 'production' && env.BETTER_AUTH_SECRET.startsWith('change-me')) {
    throw new Error('BETTER_AUTH_SECRET must be changed in production');
  }
  if (env.NODE_ENV === 'production' && env.ASAAS_WEBHOOK_TOKEN.startsWith('change-me')) {
    throw new Error('ASAAS_WEBHOOK_TOKEN must be changed in production');
  }
  if (env.NODE_ENV === 'production' && env.KEY_PEPPER.startsWith('change-me')) {
    throw new Error('KEY_PEPPER must be changed in production');
  }
  return env;
}

/** Minimal env for unit tests that do not touch the database or auth. */
export function testEnv(overrides: Partial<NodeJS.ProcessEnv> = {}): Env {
  return loadEnv({
    NODE_ENV: 'test',
    DATABASE_URL: process.env.DATABASE_URL ?? 'postgresql://localhost/unused',
    BETTER_AUTH_SECRET: 'test-secret-test-secret-test-secret',
    ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
    KEY_PEPPER: 'test-pepper-123',
    ASAAS_WEBHOOK_TOKEN: 'test-webhook-token-123',
    ASAAS_API_KEY: '$aact_hmlg_test',
    REDIS_URL: process.env.TEST_REDIS_URL ?? 'redis://localhost:6379/1',
    ...overrides,
  });
}
