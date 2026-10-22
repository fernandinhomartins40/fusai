import type { PrismaClient } from '@fusai/db';
import { z } from 'zod';

/**
 * Data retention (PIE S-11/D-05). OFF by default: the deadline is a legal decision. When the super
 * admin sets `retention_days`, logs older than that are deleted. Payments and ledger entries are
 * never touched (accounting obligations), and the minimum is 180 days (Marco Civil art. 15).
 * Audit entries about money, privacy requests and administrative actions are kept as well: they
 * prove what was charged, refunded or deleted, and who did it.
 */
export const RETENTION_KEY = 'retention_days';
export const MIN_RETENTION_DAYS = 180;

export const retentionSchema = z.object({
  days: z.union([
    z.literal(0),
    z.coerce
      .number()
      .int()
      .min(MIN_RETENTION_DAYS, `O mínimo é ${MIN_RETENTION_DAYS} dias (ou 0 para desligar)`)
      .max(3650),
  ]),
});

/** Stored in the Setting table, outside the global price settings. 0 = off. */
export async function getRetentionDays(prisma: PrismaClient): Promise<number> {
  const row = await prisma.setting.findUnique({ where: { key: RETENTION_KEY } });
  const days = Number(row?.value ?? 0);
  return Number.isInteger(days) && days >= MIN_RETENTION_DAYS ? days : 0;
}

export async function setRetentionDays(prisma: PrismaClient, days: number) {
  await prisma.setting.upsert({
    where: { key: RETENTION_KEY },
    create: { key: RETENTION_KEY, value: days },
    update: { value: days },
  });
}

/** Audit actions the retention job never deletes (prefix match). */
export const KEPT_AUDIT_PREFIXES = [
  'payment.',
  'wallet.',
  'refund',
  'privacy.',
  'app_user.',
  'adjust_end_user_credits.',
  'impersonate.',
  'user.',
  'org.',
  'settings.',
  'model.',
  'provider.',
  'team.',
];

/** Deletes logs older than the configured retention. Returns the counts, or null when off. */
export async function purgeExpiredData(prisma: PrismaClient, now = new Date()) {
  const days = await getRetentionDays(prisma);
  if (days === 0) return null;
  const before = new Date(now.getTime() - days * 86_400_000);
  const [usage, audit, outbound, inbound, sessions, invitations] = await prisma.$transaction([
    prisma.usageLog.deleteMany({ where: { createdAt: { lt: before } } }),
    prisma.auditLog.deleteMany({
      where: {
        createdAt: { lt: before },
        NOT: { OR: KEPT_AUDIT_PREFIXES.map((prefix) => ({ action: { startsWith: prefix } })) },
      },
    }),
    prisma.outboundWebhook.deleteMany({
      where: { createdAt: { lt: before }, status: { in: ['delivered', 'failed'] } },
    }),
    prisma.inboundWebhookEvent.deleteMany({
      where: { createdAt: { lt: before }, processedAt: { not: null } },
    }),
    prisma.session.deleteMany({ where: { expiresAt: { lt: before } } }),
    prisma.invitation.deleteMany({
      where: {
        createdAt: { lt: before },
        OR: [
          { acceptedAt: { not: null } },
          { revokedAt: { not: null } },
          { expiresAt: { lt: now } },
        ],
      },
    }),
  ]);
  return {
    days,
    usageLogs: usage.count,
    auditLogs: audit.count,
    outboundWebhooks: outbound.count,
    inboundWebhookEvents: inbound.count,
    sessions: sessions.count,
    invitations: invitations.count,
  };
}
