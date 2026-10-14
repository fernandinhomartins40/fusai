import nodemailer from 'nodemailer';
import type { Env } from './env';

export type Email = { to: string; subject: string; html: string; text: string };

export interface Mailer {
  send(email: Email): Promise<void>;
}

/** SMTP mailer: Mailpit in dev, Resend's SMTP relay when RESEND_API_KEY is set. */
export function createSmtpMailer(env: Env): Mailer {
  const transport = env.RESEND_API_KEY
    ? nodemailer.createTransport({
        host: 'smtp.resend.com',
        port: 465,
        secure: true,
        auth: { user: 'resend', pass: env.RESEND_API_KEY },
      })
    : nodemailer.createTransport(env.SMTP_URL);

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
