import { readFile } from 'node:fs/promises';
import type { PrismaClient } from '@fusai/db';
import { backupAlertEmail } from '../../lib/email-templates';
import type { Mailer } from '../../lib/mailer';
import type { RedisClient } from '../../lib/redis';
import { notifyOnce } from '../gateway/notify-once';

/** A verified backup older than this means the daily run failed or is not running. */
export const BACKUP_MAX_AGE_MS = 26 * 3600_000;

export type BackupStatus = {
  lastRunAt: Date | null;
  lastResult: 'ok' | 'failed' | null;
  lastOkAt: Date | null;
  lastFailedAt: Date | null;
};

const date = (value: unknown) => {
  if (typeof value !== 'string' || !value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
};

/** Reads deploy/backup's status.json. Missing file = no backup has finished yet (null). */
export async function readBackupStatus(file: string): Promise<BackupStatus | null> {
  let raw: string;
  try {
    raw = await readFile(file, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
  const json = JSON.parse(raw) as Record<string, unknown>;
  const result = json.lastResult;
  return {
    lastRunAt: date(json.lastRunAt),
    lastResult: result === 'ok' || result === 'failed' ? result : null,
    lastOkAt: date(json.lastOkAt),
    lastFailedAt: date(json.lastFailedAt),
  };
}

/** Why the backup needs attention, in pt-BR, or null when it is fine. */
export function backupProblem(status: BackupStatus | null, now = new Date()): string | null {
  if (!status) return 'Nenhum backup diário do banco foi concluído ainda.';
  if (status.lastResult === 'failed')
    return 'O último backup diário do banco falhou (o dump não foi gerado ou não passou no teste de restauração).';
  if (!status.lastOkAt || now.getTime() - status.lastOkAt.getTime() > BACKUP_MAX_AGE_MS)
    return 'O backup diário do banco está atrasado: o último backup verificado tem mais de 26 horas.';
  return null;
}

/**
 * Hourly check (worker): emails the super admins when the daily backup failed or is overdue,
 * at most once a day. A missing or unreadable status file also counts as a problem.
 */
export async function checkBackup(deps: {
  prisma: PrismaClient;
  redis: RedisClient;
  mailer: Mailer;
  appUrl: string;
  statusFile: string;
  now?: Date;
}): Promise<{ problem: string | null; notified: boolean }> {
  let problem: string | null;
  try {
    problem = backupProblem(await readBackupStatus(deps.statusFile), deps.now);
  } catch {
    problem = 'Não foi possível ler o status do backup diário.';
  }
  if (!problem) return { problem: null, notified: false };
  const reason = problem;
  const notified = await notifyOnce(deps.redis, 'backup-alert', async () => {
    const admins = await deps.prisma.user.findMany({
      where: { role: 'SUPER_ADMIN', OR: [{ banned: false }, { banned: null }] },
      select: { email: true },
    });
    for (const admin of admins) {
      await deps.mailer
        .send(backupAlertEmail(admin.email, reason, `${deps.appUrl}/admin`))
        .catch(() => {});
    }
  });
  return { problem, notified };
}
