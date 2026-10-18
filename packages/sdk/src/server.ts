import { type Fusai, FusaiError } from './client';
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

type AccountClient = Pick<Fusai, 'balance' | 'usage' | 'topups'>;

export type AccountHandlerOptions = {
  /**
   * REQUIRED: return true only for whoever may manage the credits in YOUR app (e.g. your
   * logged-in admin). Everyone else gets 401. The secret key never leaves your server.
   */
  authorize: (req: Request) => boolean | Promise<boolean>;
  /** Path where the handler is mounted (default `/api/fusai`). */
  basePath?: string;
};

const respond = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });

/**
 * Server routes for "uso próprio" (credits of YOUR organization inside your own app), on the
 * Web Request/Response API (Next.js route handlers, Remix, Hono, Bun, Deno, edge):
 *
 *   GET  {basePath}/balance          saldo da organização
 *   GET  {basePath}/usage            consumo do projeto (?from=&to=)
 *   GET  {basePath}/topup-options    mínimo, máximo e pacotes
 *   GET  {basePath}/topups           últimas recargas
 *   POST {basePath}/topups           { amountCents } ou { packageId } → Pix
 *   GET  {basePath}/topups/:id       status da recarga
 *
 * `<FusaiTopup endpoint={basePath} />` (from `@fusai/react`) talks to these routes.
 */
export function fusaiAccountHandler(fuse: AccountClient, opts: AccountHandlerOptions) {
  const base = (opts.basePath ?? '/api/fusai').replace(/\/+$/, '');
  return async (req: Request): Promise<Response> => {
    if (!(await opts.authorize(req))) {
      return respond(401, { error: { message: 'Não autorizado.', code: 'unauthorized' } });
    }
    const url = new URL(req.url);
    const path = url.pathname.startsWith(base) ? url.pathname.slice(base.length) : url.pathname;
    const parts = path.split('/').filter(Boolean);
    try {
      if (req.method === 'GET' && path === '/balance') return respond(200, await fuse.balance());
      if (req.method === 'GET' && path === '/usage') {
        return respond(
          200,
          await fuse.usage({
            from: url.searchParams.get('from') ?? undefined,
            to: url.searchParams.get('to') ?? undefined,
          }),
        );
      }
      if (req.method === 'GET' && path === '/topup-options')
        return respond(200, await fuse.topups.options());
      if (parts[0] === 'topups' && parts.length === 1) {
        if (req.method === 'GET') return respond(200, { data: await fuse.topups.list() });
        if (req.method === 'POST') {
          const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
          const amountCents = Number.isInteger(body.amountCents)
            ? Number(body.amountCents)
            : undefined;
          const packageId = typeof body.packageId === 'string' ? body.packageId : undefined;
          const returnUrl = typeof body.returnUrl === 'string' ? body.returnUrl : undefined;
          const idem = req.headers.get('idempotency-key') ?? undefined;
          return respond(
            201,
            await fuse.topups.create({
              ...(packageId ? { packageId } : { amountCents }),
              returnUrl,
              idempotencyKey: idem && idem.length <= 100 ? idem : undefined,
            }),
          );
        }
      }
      if (req.method === 'GET' && parts[0] === 'topups' && parts.length === 2 && parts[1])
        return respond(200, await fuse.topups.get(parts[1]));
      return respond(404, { error: { message: 'Rota não encontrada.', code: 'not_found' } });
    } catch (err) {
      if (err instanceof FusaiError)
        return respond(err.status, { error: { message: err.message, code: err.code } });
      return respond(500, {
        error: { message: 'Erro ao falar com a fusai.', code: 'internal_error' },
      });
    }
  };
}
