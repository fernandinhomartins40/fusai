import { createHmac, randomUUID } from 'node:crypto';
import type { Prisma, PrismaClient } from '@fusai/db';
import { decryptSecret } from '../../lib/crypto';
import { assertPublicUrl } from '../../lib/ssrf';

/** Events sent to customers (PRD §9.4). */
export type OutboundEvent =
  | 'payment.received'
  | 'payment.expired'
  | 'payment.refunded'
  | 'app_user.credited'
  | 'balance.low'
  | 'usage.limit_reached'
  | 'test.ping';

/** Retry schedule after each failed attempt (PRD §9.4): 1m, 5m, 30m, 2h, 12h; 6 attempts max. */
export const RETRY_DELAYS_MS = [60_000, 5 * 60_000, 30 * 60_000, 2 * 3_600_000, 12 * 3_600_000];
export const MAX_ATTEMPTS = RETRY_DELAYS_MS.length + 1;

/** `X-Fuse-Signature: t=<unix seconds>,v1=<hex hmac_sha256(secret, t + "." + body)>` */
export function signPayload(
  secret: string,
  body: string,
  timestamp = Math.floor(Date.now() / 1000),
) {
  const v1 = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
  return `t=${timestamp},v1=${v1}`;
}

/** Queues an event for every project that has a webhook URL (no-op otherwise). */
export async function emitEvent(
  prisma: PrismaClient | Prisma.TransactionClient,
  projectId: string,
  event: OutboundEvent,
  data: Record<string, unknown>,
) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { webhookUrl: true },
  });
  if (!project?.webhookUrl) return null;
  return prisma.outboundWebhook.create({
    data: {
      projectId,
      event,
      payload: {
        id: `evt_${randomUUID().replaceAll('-', '')}`,
        type: event,
        created: new Date().toISOString(),
        data,
      } as Prisma.InputJsonValue,
    },
  });
}

export type DeliverOptions = { encryptionKey: Buffer; production: boolean; timeoutMs?: number };
const LEASE_MS = 60_000;

/**
 * "Due" cut-off with 1 s of slack: the database rounds timestamps up to the millisecond, so a
 * row created or rescheduled a moment ago can look "1 ms in the future" and be skipped.
 */
const dueBy = (now: Date) => new Date(now.getTime() + 1000);

/** Puts a delivery back in the queue now (manual resend from the dashboard). */
export async function resendWebhook(prisma: PrismaClient, id: string, projectId: string) {
  const res = await prisma.outboundWebhook.updateMany({
    where: { id, projectId },
    data: { status: 'pending', nextAttemptAt: new Date(), lastError: null },
  });
  return res.count > 0;
}

/** One delivery attempt. Success = any 2xx; otherwise schedule the next retry or give up. */
export async function deliverWebhook(prisma: PrismaClient, id: string, opts: DeliverOptions) {
  // Lease: push nextAttemptAt forward so a concurrent run does not send it twice.
  const now = new Date();
  const claimed = await prisma.outboundWebhook.updateMany({
    where: { id, status: 'pending', nextAttemptAt: { lte: dueBy(now) } },
    data: { nextAttemptAt: new Date(now.getTime() + LEASE_MS) },
  });
  if (claimed.count === 0) return;
  const hook = await prisma.outboundWebhook.findUnique({ where: { id } });
  if (!hook) return;
  const project = await prisma.project.findUnique({ where: { id: hook.projectId } });

  let status: number | null = null;
  let error: string | null = null;
  if (!project?.webhookUrl) {
    error = 'Projeto sem URL de webhook';
  } else if (!project.webhookSecret) {
    error = 'Projeto sem segredo de webhook (gere em Configurações)';
  } else {
    try {
      await assertPublicUrl(project.webhookUrl, opts.production);
      const body = JSON.stringify(hook.payload);
      const secret = decryptSecret(project.webhookSecret, opts.encryptionKey);
      const res = await fetch(project.webhookUrl, {
        method: 'POST',
        redirect: 'manual', // a redirect could point into our network
        headers: {
          'content-type': 'application/json',
          'user-agent': 'fusai-Webhooks/1.0',
          'x-fuse-event': hook.event,
          'x-fuse-delivery': hook.id,
          'x-fuse-signature': signPayload(secret, body),
        },
        body,
        signal: AbortSignal.timeout(opts.timeoutMs ?? 10_000),
      });
      status = res.status;
      await res.body?.cancel().catch(() => {});
      if (res.status < 200 || res.status >= 300) error = `HTTP ${res.status}`;
    } catch (err) {
      error = err instanceof Error ? err.message.slice(0, 200) : 'Falha de rede';
    }
  }

  const attempts = hook.attempts + 1;
  if (!error) {
    await prisma.outboundWebhook.update({
      where: { id },
      data: {
        status: 'delivered',
        attempts,
        responseStatus: status,
        deliveredAt: new Date(),
        lastError: null,
      },
    });
    return;
  }
  const delay = RETRY_DELAYS_MS[attempts - 1];
  await prisma.outboundWebhook.update({
    where: { id },
    data: {
      attempts,
      responseStatus: status,
      lastError: error,
      ...(attempts >= MAX_ATTEMPTS || delay === undefined || hook.event === 'test.ping'
        ? { status: 'failed' }
        : { nextAttemptAt: new Date(Date.now() + delay) }),
    },
  });
}

/** Delivers every due webhook (run by the worker every 30s). */
export async function deliverDueWebhooks(prisma: PrismaClient, opts: DeliverOptions, limit = 50) {
  const due = await prisma.outboundWebhook.findMany({
    where: { status: 'pending', nextAttemptAt: { lte: dueBy(new Date()) } },
    orderBy: { nextAttemptAt: 'asc' },
    take: limit,
    select: { id: true },
  });
  await Promise.all(due.map((h) => deliverWebhook(prisma, h.id, opts)));
  return due.length;
}
