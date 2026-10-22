import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { APP_URL, createTestApp, createUserSession, resetDb, signIn } from '../../../test/helpers';
import { anonymizeDueAccounts } from './deletion';
import { purgeExpiredData } from './retention';

const DAY = 86_400_000;

describe('privacy (LGPD): export, account deletion and retention', () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let owner: string;
  let orgId: string;
  let projectId: string;

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(async () => {
    await ctx.app.close();
  });
  beforeEach(async () => {
    await resetDb();
    owner = await createUserSession(ctx.app, 'dono@example.com');
    const org = await onboard(owner, 'Org do Dono');
    orgId = org.orgId;
    projectId = org.projectId;
  });

  const call = (
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    url: string,
    cookie: string,
    payload?: object,
  ) => ctx.app.inject({ method, url, payload, headers: { cookie, origin: APP_URL } });

  async function onboard(cookie: string, name: string) {
    const org = (
      await call('POST', '/internal/onboarding/organization', cookie, {
        name,
        document: '52998224725',
        phone: '11999990000',
      })
    ).json();
    const project = (
      await call('POST', `/internal/organizations/${org.id}/projects`, cookie, { name: 'App' })
    ).json();
    return { orgId: org.id as string, projectId: project.id as string };
  }

  describe('export', () => {
    it('returns only my data and my organizations, without secrets', async () => {
      const key = (
        await call('POST', `/internal/projects/${projectId}/api-keys`, owner, { name: 'Prod' })
      ).json();
      await ctx.prisma.project.update({
        where: { id: projectId },
        data: { webhookSecret: 'segredo-cifrado-de-teste' },
      });
      const other = await createUserSession(ctx.app, 'outro@example.com');
      const otherOrg = await onboard(other, 'Org Alheia');

      const res = await call('GET', '/internal/privacy/export', owner);
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-disposition']).toMatch(/attachment; filename="fusai-meus-dados-/);
      const body = res.body;
      const data = JSON.parse(body);
      expect(data.profile.email).toBe('dono@example.com');
      expect(data.ownedOrganizations).toHaveLength(1);
      expect(data.ownedOrganizations[0].id).toBe(orgId);
      expect(data.ownedOrganizations[0].projects[0].apiKeys[0].prefix).toBe(key.prefix);

      // IDOR: nothing from the other customer.
      expect(body).not.toContain(otherOrg.orgId);
      expect(body).not.toContain('Org Alheia');
      expect(body).not.toContain('outro@example.com');
      // No secrets: key, key hash, password hash, webhook secret, session token.
      const row = await ctx.prisma.apiKey.findUniqueOrThrow({ where: { id: key.id } });
      expect(body).not.toContain(key.key);
      expect(body).not.toContain(row.hash);
      expect(body).not.toContain('segredo-cifrado-de-teste');
      const account = await ctx.prisma.account.findFirstOrThrow({
        where: { user: { email: 'dono@example.com' } },
      });
      expect(body).not.toContain(String(account.password));
      const session = await ctx.prisma.session.findFirstOrThrow({
        where: { user: { email: 'dono@example.com' } },
      });
      expect(body).not.toContain(session.token);

      expect(await ctx.prisma.auditLog.count({ where: { action: 'privacy.export' } })).toBe(1);
    });

    it('requires a session and is rate limited', async () => {
      const anon = await ctx.app.inject({ method: 'GET', url: '/internal/privacy/export' });
      expect(anon.statusCode).toBe(401);
      for (let i = 0; i < 5; i++) {
        expect((await call('GET', '/internal/privacy/export', owner)).statusCode).toBe(200);
      }
      const limited = await call('GET', '/internal/privacy/export', owner);
      expect(limited.statusCode).toBe(429);
      expect(limited.headers['retry-after']).toBeDefined();
    });
  });

  describe('account deletion', () => {
    it('requires typing the account email', async () => {
      const res = await call('POST', '/internal/privacy/deletion', owner, {
        confirmEmail: 'errado@example.com',
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('confirmation_mismatch');
    });

    it('refuses while an organization I own alone still has balance or pending Pix', async () => {
      const wallet = await ctx.prisma.wallet.update({
        where: { orgId },
        data: { balanceMicros: 1_000_000n },
      });
      await ctx.prisma.payment.create({
        data: {
          walletId: wallet.id,
          orgId,
          status: 'PENDING',
          amountCents: 500,
          creditMicros: 5_000_000n,
          idempotencyKey: 'privacy-pending',
        },
      });
      const status = (await call('GET', '/internal/privacy/deletion', owner)).json();
      expect(status.blockers.map((b: { code: string }) => b.code)).toEqual(
        expect.arrayContaining(['org_balance', 'pending_payments']),
      );

      const res = await call('POST', '/internal/privacy/deletion', owner, {
        confirmEmail: 'dono@example.com',
      });
      expect(res.statusCode).toBe(409);
      expect(res.json().error.code).toBe('deletion_blocked');
      const user = await ctx.prisma.user.findUniqueOrThrow({
        where: { email: 'dono@example.com' },
      });
      expect(user.deletionRequestedAt).toBeNull();
    });

    it('schedules the deletion for 7 days, emails the user and can be cancelled', async () => {
      const before = Date.now();
      const res = await call('POST', '/internal/privacy/deletion', owner, {
        confirmEmail: 'DONO@example.com',
      });
      expect(res.statusCode).toBe(202);
      const status = res.json();
      const delay =
        new Date(status.scheduledFor).getTime() - new Date(status.requestedAt).getTime();
      expect(delay).toBe(7 * DAY);
      expect(new Date(status.requestedAt).getTime()).toBeGreaterThanOrEqual(before - 1000);
      expect(ctx.mailer.sent.at(-1)?.to).toBe('dono@example.com');
      expect(ctx.mailer.sent.at(-1)?.subject).toMatch(/exclusão/);

      // Still within the grace period: nothing happens.
      expect((await anonymizeDueAccounts(ctx.prisma)).anonymized).toHaveLength(0);

      const cancel = await call('DELETE', '/internal/privacy/deletion', owner);
      expect(cancel.json().requestedAt).toBeNull();
      const later = await anonymizeDueAccounts(ctx.prisma, new Date(Date.now() + 8 * DAY));
      expect(later.anonymized).toHaveLength(0);
      expect(
        await ctx.prisma.auditLog.count({
          where: { action: { in: ['privacy.deletion_requested', 'privacy.deletion_cancelled'] } },
        }),
      ).toBe(2);
    });

    it('anonymizes after the grace period, keeping payments and ledger', async () => {
      const key = (
        await call('POST', `/internal/projects/${projectId}/api-keys`, owner, { name: 'Prod' })
      ).json();
      const wallet = await ctx.prisma.wallet.findUniqueOrThrow({ where: { orgId } });
      await ctx.prisma.payment.create({
        data: {
          walletId: wallet.id,
          orgId,
          status: 'RECEIVED',
          amountCents: 1000,
          creditMicros: 10_000_000n,
          idempotencyKey: 'privacy-test',
        },
      });
      await call('POST', '/internal/privacy/deletion', owner, { confirmEmail: 'dono@example.com' });
      const user = await ctx.prisma.user.findUniqueOrThrow({
        where: { email: 'dono@example.com' },
      });
      await ctx.prisma.user.update({ where: { id: user.id }, data: { twoFactorEnabled: true } });
      await ctx.prisma.twoFactor.create({
        data: { id: 'tf-1', secret: 'cifrado', backupCodes: 'cifrado', userId: user.id },
      });

      const result = await anonymizeDueAccounts(
        ctx.prisma,
        new Date(Date.now() + 7 * DAY + 60_000),
      );
      expect(result.anonymized).toEqual([user.id]);

      const after = await ctx.prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(after.email).toBe(`excluido-${user.id}@anonimizado.invalid`);
      expect(after.name).toBe('Conta excluída');
      expect(after.banned).toBe(true);
      expect(after.deletedAt).not.toBeNull();
      expect(after.twoFactorEnabled).toBe(false);
      expect(await ctx.prisma.twoFactor.count({ where: { userId: user.id } })).toBe(0);
      expect(await ctx.prisma.session.count({ where: { userId: user.id } })).toBe(0);
      expect(await ctx.prisma.account.count({ where: { userId: user.id } })).toBe(0);
      expect(await ctx.prisma.membership.count({ where: { userId: user.id } })).toBe(0);
      // The old session and the old password no longer work.
      expect((await call('GET', '/internal/me', owner)).statusCode).toBe(401);
      expect((await signIn(ctx.app, 'dono@example.com')).res.statusCode).not.toBe(200);

      const org = await ctx.prisma.organization.findUniqueOrThrow({ where: { id: orgId } });
      expect(org.status).toBe('SUSPENDED');
      expect(org.phone).toBeNull();
      const apiKey = await ctx.prisma.apiKey.findUniqueOrThrow({ where: { id: key.id } });
      expect(apiKey.revokedAt).not.toBeNull();
      expect(await ctx.prisma.payment.count({ where: { orgId } })).toBe(1);
      expect(
        await ctx.prisma.auditLog.count({ where: { action: 'privacy.account_anonymized' } }),
      ).toBe(1);
    });

    it('skips the anonymization when a balance appears during the grace period', async () => {
      await call('POST', '/internal/privacy/deletion', owner, { confirmEmail: 'dono@example.com' });
      await ctx.prisma.wallet.update({ where: { orgId }, data: { balanceMicros: 5_000_000n } });
      const result = await anonymizeDueAccounts(ctx.prisma, new Date(Date.now() + 8 * DAY));
      expect(result.anonymized).toHaveLength(0);
      expect(result.blocked).toHaveLength(1);
      const user = await ctx.prisma.user.findUniqueOrThrow({
        where: { email: 'dono@example.com' },
      });
      expect(user.deletedAt).toBeNull();
      expect(
        await ctx.prisma.auditLog.count({
          where: { action: 'privacy.deletion_blocked', target: user.id },
        }),
      ).toBe(1);

      // The next hourly run skips it (retried once a day), so it cannot starve other accounts.
      const nextHour = await anonymizeDueAccounts(
        ctx.prisma,
        new Date(Date.now() + 8 * DAY + 3_600_000),
      );
      expect(nextHour.blocked).toHaveLength(0);
      const nextDay = await anonymizeDueAccounts(ctx.prisma, new Date(Date.now() + 9 * DAY));
      expect(nextDay.blocked).toEqual([user.id]);
    });

    it('is not available while a super admin impersonates the customer', async () => {
      const user = await ctx.prisma.user.findUniqueOrThrow({
        where: { email: 'dono@example.com' },
      });
      await ctx.prisma.session.updateMany({
        where: { userId: user.id },
        data: { impersonatedBy: 'admin-id' },
      });
      const res = await call('POST', '/internal/privacy/deletion', owner, {
        confirmEmail: 'dono@example.com',
      });
      expect(res.statusCode).toBe(403);
      expect((await call('GET', '/internal/privacy/export', owner)).statusCode).toBe(403);
    });
  });

  describe('retention', () => {
    it('is off by default and only a super admin can enable it (minimum 180 days)', async () => {
      expect(await purgeExpiredData(ctx.prisma)).toBeNull();
      const customer = await call('PUT', '/internal/admin/privacy/retention', owner, { days: 365 });
      expect(customer.statusCode).toBe(403);

      const admin = await createUserSession(ctx.app, 'admin@example.com', 'SUPER_ADMIN');
      expect(
        (await call('PUT', '/internal/admin/privacy/retention', admin, { days: 30 })).statusCode,
      ).toBe(400);
      const ok = await call('PUT', '/internal/admin/privacy/retention', admin, { days: 180 });
      expect(ok.json()).toEqual({ days: 180 });
      expect((await call('GET', '/internal/admin/privacy/retention', admin)).json()).toEqual({
        days: 180,
      });
    });

    it('deletes old logs but never payments or ledger entries', async () => {
      const admin = await createUserSession(ctx.app, 'admin@example.com', 'SUPER_ADMIN');
      await call('PUT', '/internal/admin/privacy/retention', admin, { days: 180 });
      const old = new Date(Date.now() - 200 * DAY);
      const recent = new Date(Date.now() - 10 * DAY);
      const usage = (requestId: string, createdAt: Date) => ({
        requestId,
        orgId,
        projectId,
        modelId: 'm',
        providerId: 'p',
        status: 'SUCCESS' as const,
        createdAt,
      });
      await ctx.prisma.usageLog.createMany({
        data: [usage('old', old), usage('recent', recent)],
      });
      await ctx.prisma.auditLog.createMany({
        data: [
          { action: 'test.old', createdAt: old },
          { action: 'payment.needs_review', createdAt: old },
          { action: 'wallet.adjust', createdAt: old },
          { action: 'privacy.account_anonymized', createdAt: old },
          { action: 'impersonate.start', createdAt: old },
        ],
      });
      const wallet = await ctx.prisma.wallet.findUniqueOrThrow({ where: { orgId } });
      await ctx.prisma.ledgerEntry.create({
        data: {
          walletId: wallet.id,
          type: 'ADJUSTMENT',
          amountMicros: 0n,
          balanceAfter: 0n,
          createdAt: old,
        },
      });
      const ledgerBefore = await ctx.prisma.ledgerEntry.count();

      const purged = await purgeExpiredData(ctx.prisma);
      expect(purged).toMatchObject({ days: 180, usageLogs: 1, auditLogs: 1 });
      expect(await ctx.prisma.usageLog.findMany({ select: { requestId: true } })).toEqual([
        { requestId: 'recent' },
      ]);
      expect(await ctx.prisma.ledgerEntry.count()).toBe(ledgerBefore);
      const kept = await ctx.prisma.auditLog.findMany({
        where: { createdAt: { lt: new Date(Date.now() - 180 * DAY) } },
        select: { action: true },
        orderBy: { action: 'asc' },
      });
      expect(kept.map((row) => row.action)).toEqual([
        'impersonate.start',
        'payment.needs_review',
        'privacy.account_anonymized',
        'wallet.adjust',
      ]);
    });
  });
});
