import { readFileSync } from 'node:fs';
import { MAIL_FILE } from './env';

const SEPARATOR = '\n=====END=====\n';

/** Decodes a quoted-printable body as stored by the SMTP sink. */
function decode(message: string): string {
  return message
    .replace(/=\r?\n/g, '')
    .replace(/=([0-9A-F]{2})/g, (_, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)));
}

/** Waits for the newest message to `to` and returns the first link that matches `pattern`. */
export async function waitForLink(
  to: string,
  pattern: RegExp,
  timeoutMs = 30_000,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    // Split before decoding: the decoder would join the separator with the next line.
    const messages = readFileSync(MAIL_FILE, 'utf8').split(SEPARATOR).reverse();
    const message = messages.find((m) => m.includes(`To: ${to}`));
    const link = message && decode(message).match(pattern)?.[0];
    if (link) return link.replace(/&amp;|&#38;/g, '&');
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`No email to ${to} with a link matching ${pattern}`);
}
