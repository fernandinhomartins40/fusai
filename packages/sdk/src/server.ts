import type { WebhookEvent } from './types';

/** Default tolerance between the signature timestamp and now (replay protection). */
export const WEBHOOK_TOLERANCE_SECONDS = 300;

const encoder = new TextEncoder();

async function hmacHex(secret: string, payload: string) {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(payload)));
  return Array.from(sig, (b) => b.toString(16).padStart(2, '0')).join('');
}

function timingSafeEqualHex(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Verifies `X-Fuse-Signature: t=<unix>,v1=<hex hmac_sha256(secret, t + "." + body)>` and returns
 * the parsed event, or null when the signature is invalid or too old. `rawBody` must be the exact
 * request body string (read it before any JSON parsing). Works on Node 18+, Deno, Bun and edge.
 */
export async function verifyWebhook<T = Record<string, unknown>>(
  secret: string,
  signatureHeader: string | null | undefined,
  rawBody: string,
  opts: { toleranceSeconds?: number; now?: number } = {},
): Promise<WebhookEvent<T> | null> {
  if (!signatureHeader) return null;
  const parts = Object.fromEntries(
    signatureHeader.split(',').map((p) => {
      const i = p.indexOf('=');
      return [p.slice(0, i).trim(), p.slice(i + 1).trim()];
    }),
  );
  const t = Number(parts.t);
  const v1 = parts.v1;
  if (!Number.isInteger(t) || !v1) return null;
  const now = Math.floor((opts.now ?? Date.now()) / 1000);
  if (Math.abs(now - t) > (opts.toleranceSeconds ?? WEBHOOK_TOLERANCE_SECONDS)) return null;
  const expected = await hmacHex(secret, `${t}.${rawBody}`);
  if (!timingSafeEqualHex(expected, v1)) return null;
  try {
    return JSON.parse(rawBody) as WebhookEvent<T>;
  } catch {
    return null;
  }
}
