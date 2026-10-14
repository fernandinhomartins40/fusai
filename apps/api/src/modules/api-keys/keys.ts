import { createHash, randomInt, timingSafeEqual } from 'node:crypto';

/**
 * Customer API keys (PRD §8): `fai_live_` / `fai_test_` + 40 random base62 chars.
 * Only sha256(key + KEY_PEPPER) and a 12-char display prefix are stored.
 */
const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
export const KEY_RANDOM_LENGTH = 40;
export const KEY_PREFIX_LENGTH = 12;
const KEY_RE = /^fai_(live|test)_[0-9A-Za-z]{40}$/;

export type KeyEnvValue = 'LIVE' | 'TEST';

export const API_KEY_SCOPES = ['chat', 'billing:read', 'checkout', 'app_users', 'mcp'] as const;
export type ApiKeyScope = (typeof API_KEY_SCOPES)[number];

export function generateApiKey(env: KeyEnvValue): string {
  let random = '';
  // randomInt is uniform (no modulo bias) and backed by crypto.randomBytes.
  for (let i = 0; i < KEY_RANDOM_LENGTH; i++) random += BASE62[randomInt(BASE62.length)];
  return `fai_${env === 'LIVE' ? 'live' : 'test'}_${random}`;
}

export function hashApiKey(key: string, pepper: string): string {
  return createHash('sha256')
    .update(key + pepper)
    .digest('hex');
}

export function keyDisplayPrefix(key: string): string {
  return key.slice(0, KEY_PREFIX_LENGTH);
}

export function looksLikeApiKey(value: string): boolean {
  return KEY_RE.test(value);
}

/** Constant-time comparison of two hex digests. */
export function hashesEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}
