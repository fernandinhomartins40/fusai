import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * AES-256-GCM for provider API keys at rest.
 * Format: "v1.<iv b64url>.<auth tag b64url>.<ciphertext b64url>".
 */
const VERSION = 'v1';

export function parseEncryptionKey(base64: string): Buffer {
  const key = Buffer.from(base64, 'base64');
  if (key.length !== 32) throw new Error('ENCRYPTION_KEY must be 32 bytes encoded as base64');
  return key;
}

export function encryptSecret(plain: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv, tag, ciphertext]
    .map((p) => (typeof p === 'string' ? p : p.toString('base64url')))
    .join('.');
}

export function decryptSecret(encrypted: string, key: Buffer): string {
  const [version, iv, tag, ciphertext] = encrypted.split('.');
  if (version !== VERSION || !iv || !tag || !ciphertext)
    throw new Error('Invalid encrypted secret');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

/** "sk-abc…wxyz" style mask; never reveals more than the first 3 and last 4 characters. */
export function maskSecret(plain: string): string {
  if (plain.length <= 10) return '••••';
  return `${plain.slice(0, 3)}…${plain.slice(-4)}`;
}
