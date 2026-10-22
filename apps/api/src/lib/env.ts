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
  /** Signs end-user session tokens (HS256, 15 min). */
  SESSION_TOKEN_SECRET: z.string().min(8),

  ASAAS_ENV: z.enum(['sandbox', 'production']).default('sandbox'),
  ASAAS_API_KEY: optional,
  /** Overrides the base URL derived from ASAAS_ENV (tests and local fakes). */
  ASAAS_API_URL: optional,
  ASAAS_WEBHOOK_TOKEN: z.string().min(8),

  EMAIL_FROM: z.string().default('fusai <nao-responda@fusai.com.br>'),
  /** VeloMail transactional key `re_...` (scope email:send). The `uai_` AI Agent Key is for MCP only. */
  VELOMAIL_API_KEY: optional.refine((v) => !v || v.startsWith('re_'), {
    message: 'VELOMAIL_API_KEY deve ser uma API key padrão re_... (a uai_ é só para o MCP)',
  }),
  VELOMAIL_API_URL: z.url().default('https://www.velomail.com.br/api'),
  /** HMAC secret of the VeloMail webhook endpoint (X-Webhook-Signature). */
  VELOMAIL_WEBHOOK_SECRET: optional,
  SMTP_URL: z.string().default('smtp://localhost:1025'),
  /** status.json written by the daily backup (deploy/backup); unset = no backup alert. */
  BACKUP_STATUS_FILE: optional,
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
  if (env.NODE_ENV === 'production' && env.SESSION_TOKEN_SECRET.startsWith('change-me')) {
    throw new Error('SESSION_TOKEN_SECRET must be changed in production');
  }
  if (env.NODE_ENV === 'production' && env.KEY_PEPPER.startsWith('change-me')) {
    throw new Error('KEY_PEPPER must be changed in production');
  }
  if (env.NODE_ENV === 'production') assertStrongSecrets(env);
  return env;
}

/**
 * Minimum lengths in production (PIE S-14). deploy.sh generates 64 hex chars for all three.
 * KEY_PEPPER only needs 16: changing it invalidates every customer API key, so an existing
 * shorter pepper is never forced to rotate by a stricter rule here.
 */
const MIN_SECRET_LENGTH = {
  BETTER_AUTH_SECRET: 32,
  SESSION_TOKEN_SECRET: 32,
  KEY_PEPPER: 16,
} as const;

function assertStrongSecrets(env: Env) {
  for (const [name, min] of Object.entries(MIN_SECRET_LENGTH)) {
    const value = env[name as keyof typeof MIN_SECRET_LENGTH];
    // Never print the value, only its name and the rule.
    if (value.length < min)
      throw new Error(
        `${name} must have at least ${min} characters in production (generate with: openssl rand -hex 32)`,
      );
  }
}

/** Minimal env for unit tests that do not touch the database or auth. */
export function testEnv(overrides: Partial<NodeJS.ProcessEnv> = {}): Env {
  return loadEnv({
    NODE_ENV: 'test',
    DATABASE_URL: process.env.DATABASE_URL ?? 'postgresql://localhost/unused',
    BETTER_AUTH_SECRET: 'test-secret-test-secret-test-secret',
    ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
    KEY_PEPPER: 'test-pepper-123',
    SESSION_TOKEN_SECRET: 'test-session-secret-123',
    ASAAS_WEBHOOK_TOKEN: 'test-webhook-token-123',
    ASAAS_API_KEY: '$aact_hmlg_test',
    REDIS_URL: process.env.TEST_REDIS_URL ?? 'redis://localhost:6379/1',
    ...overrides,
  });
}
