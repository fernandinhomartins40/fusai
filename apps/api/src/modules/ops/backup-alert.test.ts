import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, resetDb } from '../../../test/helpers';
import { backupProblem, checkBackup, readBackupStatus } from './backup-alert';

const now = new Date('2026-10-23T12:00:00Z');
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3600_000).toISOString();
const status = (fields: Record<string, string>) =>
  JSON.stringify({ lastRunAt: '', lastResult: '', lastOkAt: '', lastFailedAt: '', ...fields });

describe('PIE V-01: backup status', () => {
  let dir: string;
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'backup-status-'));
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('reads the file written by deploy/backup/backup.sh', async () => {
    const file = join(dir, 'status.json');
    expect(await readBackupStatus(file)).toBeNull();
    await writeFile(
      file,
      '{"lastRunAt": "2026-10-23T06:31:10Z", "lastResult": "failed", "lastOkAt": "2026-10-22T06:31:02Z", "lastFailedAt": "2026-10-23T06:31:10Z"}\n',
    );
    expect(await readBackupStatus(file)).toEqual({
      lastRunAt: new Date('2026-10-23T06:31:10Z'),
      lastResult: 'failed',
      lastOkAt: new Date('2026-10-22T06:31:02Z'),
      lastFailedAt: new Date('2026-10-23T06:31:10Z'),
    });
  });

  it('flags a failed run, an overdue backup and a missing one', () => {
    const ok = { lastRunAt: null, lastFailedAt: null };
    expect(backupProblem({ ...ok, lastResult: 'ok', lastOkAt: new Date(hoursAgo(5)) }, now)).toBe(
      null,
    );
    expect(
      backupProblem({ ...ok, lastResult: 'ok', lastOkAt: new Date(hoursAgo(27)) }, now),
    ).toMatch(/atrasado/);
    expect(
      backupProblem({ ...ok, lastResult: 'failed', lastOkAt: new Date(hoursAgo(2)) }, now),
    ).toMatch(/falhou/);
    expect(backupProblem(null, now)).toMatch(/Nenhum backup/);
  });
});

describe('PIE V-01: backup alert email', () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let dir: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    dir = await mkdtemp(join(tmpdir(), 'backup-alert-'));
  });
  afterAll(async () => {
    await ctx.app.close();
    await rm(dir, { recursive: true, force: true });
  });
  beforeEach(async () => {
    await resetDb();
    ctx.mailer.sent.length = 0;
  });

  it('emails the super admins once a day when the backup fails, and nobody when it is fine', async () => {
    await ctx.prisma.user.createMany({
      data: [
        { id: 'root', name: 'Root', email: 'root@example.com', role: 'SUPER_ADMIN' },
        { id: 'cli', name: 'Cliente', email: 'cliente@example.com', role: 'USER' },
      ],
    });
    const statusFile = join(dir, 'status.json');
    const deps = { ...ctx, appUrl: 'https://www.fusai.com.br', statusFile, now };

    await writeFile(statusFile, status({ lastResult: 'ok', lastOkAt: hoursAgo(3) }));
    expect(await checkBackup(deps)).toEqual({ problem: null, notified: false });
    expect(ctx.mailer.sent).toHaveLength(0);

    await writeFile(
      statusFile,
      status({ lastResult: 'failed', lastOkAt: hoursAgo(25), lastFailedAt: hoursAgo(1) }),
    );
    const first = await checkBackup(deps);
    expect(first.notified).toBe(true);
    expect(ctx.mailer.sent.map((m) => m.to)).toEqual(['root@example.com']);
    expect(ctx.mailer.sent[0]?.subject).toMatch(/Backup diário/);
    expect(ctx.mailer.sent[0]?.text).toMatch(/falhou/);

    // Next hourly check, still failing: no second email the same day.
    expect((await checkBackup(deps)).notified).toBe(false);
    expect(ctx.mailer.sent).toHaveLength(1);
  });
});
