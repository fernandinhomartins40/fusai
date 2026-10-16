import nodemailer from 'nodemailer';
import type { Env } from './env';

export type Email = { to: string; subject: string; html: string; text: string };

export interface Mailer {
  send(email: Email): Promise<void>;
}

/** Failed delivery to the email provider. `code` comes from VeloMail (e.g. DOMAIN_NOT_VERIFIED). */
export class MailerError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'MailerError';
  }
}

/** Production: VeloMail when VELOMAIL_API_KEY is set. Dev/tests: SMTP (Mailpit). */
export function createMailer(env: Env): Mailer {
  return env.VELOMAIL_API_KEY
    ? createVeloMailMailer(env, env.VELOMAIL_API_KEY)
    : createSmtpMailer(env);
}

const MAX_ATTEMPTS = 3;
const MAX_WAIT_MS = 5_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * VeloMail transactional API: POST {VELOMAIL_API_URL}/emails/send with the `re_...` key in
 * `x-api-key`. 429 and 5xx are retried (respecting `retryAfter`, capped at 5 s, 3 attempts);
 * other errors throw MailerError with VeloMail's `code`. Never logs the message content.
 */
export function createVeloMailMailer(
  env: Pick<Env, 'VELOMAIL_API_URL' | 'EMAIL_FROM'>,
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
): Mailer {
  const url = `${env.VELOMAIL_API_URL.replace(/\/+$/, '')}/emails/send`;
  return {
    async send(email) {
      for (let attempt = 1; ; attempt++) {
        let res: Response;
        try {
          res = await fetchImpl(url, {
            method: 'POST',
            headers: { 'x-api-key': apiKey, 'content-type': 'application/json' },
            body: JSON.stringify({ from: env.EMAIL_FROM, ...email }),
            signal: AbortSignal.timeout(15_000),
          });
        } catch (err) {
          if (attempt < MAX_ATTEMPTS) {
            await sleep(attempt * 500);
            continue;
          }
          throw new MailerError(
            `VeloMail inacessível: ${err instanceof Error ? err.message : 'erro de rede'}`,
          );
        }
        if (res.ok) {
          await res.body?.cancel().catch(() => {});
          return;
        }
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
          code?: string;
          retryAfter?: number;
        };
        const retryable = res.status === 429 || res.status >= 500;
        if (retryable && attempt < MAX_ATTEMPTS) {
          const wait = body.retryAfter ? body.retryAfter * 1000 : 2 ** attempt * 250;
          await sleep(Math.min(wait, MAX_WAIT_MS));
          continue;
        }
        throw new MailerError(
          `VeloMail ${res.status}${body.code ? ` ${body.code}` : ''}: ${body.error ?? 'falha no envio'}`,
          res.status,
          body.code,
        );
      }
    },
  };
}

/** SMTP mailer (Mailpit in dev). */
export function createSmtpMailer(env: Pick<Env, 'SMTP_URL' | 'EMAIL_FROM'>): Mailer {
  const transport = nodemailer.createTransport(env.SMTP_URL);
  return {
    async send(email) {
      await transport.sendMail({ from: env.EMAIL_FROM, ...email });
    },
  };
}

/** In-memory mailer for tests. */
export function createMemoryMailer(): Mailer & { sent: Email[] } {
  const sent: Email[] = [];
  return {
    sent,
    async send(email) {
      sent.push(email);
    },
  };
}
