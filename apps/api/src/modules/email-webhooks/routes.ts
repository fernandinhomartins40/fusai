import { createHmac, timingSafeEqual } from 'node:crypto';
import { Prisma, type PrismaClient } from '@fusai/db';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

/** VeloMail delivery events (email.sent, email.delivered, email.bounced, ...). */
const eventSchema = z.object({
  event: z.string().min(1).max(64),
  timestamp: z.string().min(1).max(64),
  webhook_id: z.union([z.string(), z.number()]).optional(),
  data: z
    .object({
      email_id: z.union([z.string(), z.number()]).optional(),
      message_id: z.string().max(255).optional(),
      status: z.string().max(64).optional(),
    })
    .loose(),
});

/** Events that mean the recipient address is a problem (logged for follow-up). */
const ALERT_EVENTS = new Set(['email.bounced', 'email.failed', 'email.spam_complaint']);

/** `X-Webhook-Signature: sha256=<hex hmac_sha256(secret, raw body)>`, compared in constant time. */
export function validVeloMailSignature(
  rawBody: Buffer,
  header: string | undefined,
  secret: string,
): boolean {
  if (!header) return false;
  const expected = Buffer.from(
    `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`,
  );
  const received = Buffer.from(header.trim());
  return received.length === expected.length && timingSafeEqual(received, expected);
}

/**
 * Public: VeloMail -> fusai. The signature is computed over the RAW bytes, so this plugin swaps
 * the JSON parser for a Buffer one (encapsulated: only these routes). Each event is stored once
 * (key event + message + timestamp, because VeloMail retries) and acknowledged with 200 at once.
 */
export const emailWebhookRoutes: FastifyPluginAsync<{
  prisma: PrismaClient;
  secret: string | undefined;
}> = async (app, { prisma, secret }) => {
  app.removeContentTypeParser('application/json');
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_req, body, done) =>
    done(null, body),
  );

  app.post('/webhooks/velomail', { bodyLimit: 256 * 1024 }, async (req, reply) => {
    if (!secret) {
      req.log.error('VELOMAIL_WEBHOOK_SECRET ausente: webhook da VeloMail recusado');
      return reply
        .status(503)
        .send({ error: { message: 'Webhook não configurado', code: 'not_configured' } });
    }
    const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    const signature = req.headers['x-webhook-signature'];
    if (
      !validVeloMailSignature(raw, typeof signature === 'string' ? signature : undefined, secret)
    ) {
      return reply
        .status(401)
        .send({ error: { message: 'Assinatura inválida', code: 'invalid_signature' } });
    }

    let parsed: z.infer<typeof eventSchema>;
    try {
      parsed = eventSchema.parse(JSON.parse(raw.toString('utf8')));
    } catch {
      return reply
        .status(400)
        .send({ error: { message: 'Evento inválido', code: 'invalid_event' } });
    }

    const ref = parsed.data.message_id ?? String(parsed.data.email_id ?? '-');
    const eventKey = `velomail:${parsed.event}:${ref}:${parsed.timestamp}`.slice(0, 500);
    try {
      await prisma.inboundWebhookEvent.create({
        data: {
          provider: 'velomail',
          eventKey,
          type: parsed.event,
          // Only ids and status: VeloMail also sends the recipient, which we do not need to keep.
          payload: {
            event: parsed.event,
            timestamp: parsed.timestamp,
            data: {
              email_id: parsed.data.email_id ?? null,
              message_id: parsed.data.message_id ?? null,
              status: parsed.data.status ?? null,
            },
          },
          processedAt: new Date(),
        },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return reply.send({ received: true, duplicate: true });
      }
      throw err;
    }

    // Never log addresses or content: event, message id and status are enough to investigate.
    if (ALERT_EVENTS.has(parsed.event)) {
      req.log.warn(
        { event: parsed.event, messageId: parsed.data.message_id, status: parsed.data.status },
        'VeloMail: falha de entrega de e-mail',
      );
    }
    return reply.send({ received: true });
  });
};
