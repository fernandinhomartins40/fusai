import { describe, expect, it } from 'vitest';
import { loadEnv } from './env';

const strong = 'a'.repeat(64);
const production = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://localhost/unused',
  BETTER_AUTH_SECRET: strong,
  ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
  KEY_PEPPER: strong,
  SESSION_TOKEN_SECRET: strong,
  ASAAS_WEBHOOK_TOKEN: strong,
};

describe('PIE S-14: strong secrets in production', () => {
  it('boots with the secrets deploy.sh generates', () => {
    expect(loadEnv(production).NODE_ENV).toBe('production');
  });

  it.each([
    ['BETTER_AUTH_SECRET', 'b'.repeat(31)],
    ['SESSION_TOKEN_SECRET', 's'.repeat(31)],
    ['KEY_PEPPER', 'p'.repeat(15)],
  ])('refuses a short %s without printing it', (name, value) => {
    let message = '';
    try {
      loadEnv({ ...production, [name]: value });
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toContain(name);
    expect(message).not.toContain(value);
  });

  it('accepts a 16-char KEY_PEPPER (rotating it would invalidate every API key)', () => {
    expect(() => loadEnv({ ...production, KEY_PEPPER: 'p'.repeat(16) })).not.toThrow();
  });

  it('does not apply the rule outside production', () => {
    expect(() =>
      loadEnv({ ...production, NODE_ENV: 'development', BETTER_AUTH_SECRET: 'x'.repeat(16) }),
    ).not.toThrow();
  });
});
