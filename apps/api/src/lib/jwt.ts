import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Minimal HS256 JWT (no dependency): only what session tokens need.
 * Verification pins the algorithm (never trusts the header's `alg`) and checks `exp`.
 */
const b64 = (data: string | Buffer) => Buffer.from(data).toString('base64url');
const HEADER = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));

export function signJwt(payload: Record<string, unknown>, secret: string): string {
  const body = b64(JSON.stringify(payload));
  const sig = createHmac('sha256', secret).update(`${HEADER}.${body}`).digest('base64url');
  return `${HEADER}.${body}.${sig}`;
}

export function verifyJwt<T extends { exp?: number }>(
  token: string,
  secret: string,
  now = Date.now(),
): T | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, body, sig] = parts as [string, string, string];
  if (header !== HEADER) return null; // rejects alg=none and any other algorithm
  const expected = createHmac('sha256', secret).update(`${header}.${body}`).digest();
  const given = Buffer.from(sig, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  let payload: T;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as T;
  } catch {
    return null;
  }
  if (typeof payload.exp !== 'number' || payload.exp * 1000 <= now) return null;
  return payload;
}
