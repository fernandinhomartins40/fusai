import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { decryptSecret, encryptSecret, maskSecret, parseEncryptionKey } from './crypto';

const key = randomBytes(32);

describe('provider key encryption', () => {
  it('round-trips and never stores the plaintext', () => {
    const secret = 'sk-test-1234567890abcdef';
    const encrypted = encryptSecret(secret, key);
    expect(encrypted).not.toContain(secret);
    expect(encrypted.startsWith('v1.')).toBe(true);
    expect(decryptSecret(encrypted, key)).toBe(secret);
  });

  it('uses a random IV per encryption', () => {
    expect(encryptSecret('same-secret', key)).not.toBe(encryptSecret('same-secret', key));
  });

  it('rejects tampering and wrong keys', () => {
    const encrypted = encryptSecret('sk-test-1234567890', key);
    const parts = encrypted.split('.');
    const ct = Buffer.from(parts[3] as string, 'base64url');
    ct[0] = (ct[0] ?? 0) ^ 1;
    parts[3] = ct.toString('base64url');
    expect(() => decryptSecret(parts.join('.'), key)).toThrow();
    expect(() => decryptSecret(encrypted, randomBytes(32))).toThrow();
    expect(() => decryptSecret('garbage', key)).toThrow();
  });

  it('validates the key size', () => {
    expect(parseEncryptionKey(key.toString('base64'))).toHaveLength(32);
    expect(() => parseEncryptionKey('base64-32-bytes')).toThrow();
  });

  it('masks secrets', () => {
    expect(maskSecret('sk-1234567890abcdef')).toBe('sk-…cdef');
    expect(maskSecret('short')).toBe('••••');
  });
});
