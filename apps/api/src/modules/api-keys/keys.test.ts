import { describe, expect, it } from 'vitest';
import { generateApiKey, hashApiKey, hashesEqual, keyDisplayPrefix, looksLikeApiKey } from './keys';

describe('api keys', () => {
  it('generates live/test keys with 40 base62 characters', () => {
    const live = generateApiKey('LIVE');
    const test = generateApiKey('TEST');
    expect(live).toMatch(/^fai_live_[0-9A-Za-z]{40}$/);
    expect(test).toMatch(/^fai_test_[0-9A-Za-z]{40}$/);
    expect(looksLikeApiKey(live)).toBe(true);
    expect(looksLikeApiKey(`${live}x`)).toBe(false);
    expect(looksLikeApiKey('sk-123')).toBe(false);
  });

  it('never repeats', () => {
    const keys = new Set(Array.from({ length: 1000 }, () => generateApiKey('LIVE')));
    expect(keys.size).toBe(1000);
  });

  it('hashes with the pepper and exposes only a short prefix', () => {
    const key = generateApiKey('LIVE');
    const hash = hashApiKey(key, 'pepper-a');
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toBe(hashApiKey(key, 'pepper-b'));
    expect(hashesEqual(hash, hashApiKey(key, 'pepper-a'))).toBe(true);
    expect(hashesEqual(hash, hashApiKey(key, 'pepper-b'))).toBe(false);
    expect(keyDisplayPrefix(key)).toBe(key.slice(0, 12));
    expect(keyDisplayPrefix(key).startsWith('fai_live_')).toBe(true);
  });
});
