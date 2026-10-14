import { prisma } from '@fuseai/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  APP_URL,
  createTestApp,
  createUserSession,
  resetDb,
  signIn,
  signUp,
} from '../../../test/helpers';

describe('customer dashboard (phase 5)', () => {
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
    ctx.app.caches.invalidate();
    ctx.mailer.sent.length = 0;
    owner = await createUserSession(ctx.app, 'dono@example.com');
    orgId = (
      await call('POST', '/internal/onboarding/organization', owner, {
        name: 'Org Um',
        document: '52998224725',
        phone: '11999990000',
      })
    ).json().id;
    projectId = (
      await call('POST', `/internal/organizations/${orgId}/projects`, owner, { name: 'App' })
    ).json().id;
  });

  const call = (
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    url: string,
    cookie: string,
    payload?: object,
  ) => ctx.app.inject({ method, url, payload, headers: { cookie, origin: APP_URL } });

  async function seedModel(slug = 'fuse/x') {
    const provider = await prisma.provider.create({
      data: {
        slug: `p-${slug.replace(/\W/g, '')}`,
        name: 'P',
        baseUrl: 'http://x',
        apiKeyEnc: '',
        status: 'DISABLED',
      },
    });
    return prisma.model.create({
      data: {
        slug,
        displayName: slug,
        providerId: provider.id,
        upstreamModel: 'x',
        contextWindow: 1000,
        inputCostUsdPerM: '1',
        outputCostUsdPerM: '2',
        active: true,
      },
    });
  }

  async function log(createdAt: string, charged: bigint, modelId: string, extra: object = {}) {
    await prisma.usageLog.create({
      data: {
        requestId: `r-${Math.random()}`,
        orgId,
        projectId,
        modelId,
        providerId: 'p',
        promptTokens: 10,
        completionTokens: 5,
        chargedMicros: charged,
        status: 'SUCCESS',
        createdAt: new Date(createdAt),
        ...extra,
      },
    });
  }

  describe('analytics', () => {
    it('buckets usage by São Paulo day and fills empty days', async () => {
      const m = await seedModel();
      const day = (d: number) => new Date(Date.now() - d * 86_400_000);
      await log(day(0).toISOString(), 1_000n, m.id);
      await log(day(2).toISOString(), 2_000n, m.id);
      await log(day(40).toISOString(), 9_999n, m.id); // outside 30 days

      const res = await call('GET', `/internal/organizations/${orgId}/overview`, owner);
      expect(res.statusCode).toBe(200);
      const o = res.json();
      expect(o.daily).toHaveLength(30);
      expect(
        o.daily.reduce(
          (s: bigint, d: { chargedMicros: string }) => s + BigInt(d.chargedMicros),
          0n,
        ),
      ).toBe(3_000n);
      expect(o.spend).toMatchObject({ today: '1000', last30d: '3000' });
      expect(o.requests.last30d).toBe(2);
      expect(o.byModel).toMatchObject([{ slug: 'fuse/x', chargedMicros: '3000', requests: 2 }]);
      expect(o.lowBalance).toMatchObject({ isLow: true, thresholdMicros: '5000000' });
    });

    it('uses the São Paulo calendar: 02:59 UTC still counts as the previous day', async () => {
      const m = await seedModel();
      await log('2026-01-15T02:59:00Z', 100n, m.id);
      await log('2026-01-15T03:00:00Z', 200n, m.id);
      const res = await call(
        'GET',
        `/internal/organizations/${orgId}/usage?from=2026-01-14T03:00:00Z&to=2026-01-16T03:00:00Z`,
        owner,
      );
      const days = res
        .json()
        .daily.map((d: { day: string; chargedMicros: string }) => [d.day, d.chargedMicros]);
      expect(days).toEqual([
        ['2026-01-14', '100'],
        ['2026-01-15', '200'],
      ]);
    });

    it('filters usage, exports CSV safely and paginates logs', async () => {
      const m = await seedModel('fuse/a');
      const n = await seedModel('fuse/b');
      for (let i = 0; i < 3; i++) await log(new Date().toISOString(), 100n, m.id);
      await log(new Date().toISOString(), 500n, n.id, {
        status: 'UPSTREAM_ERROR',
        errorCode: 'upstream_error',
      });

      const filtered = (
        await call('GET', `/internal/organizations/${orgId}/usage?modelId=${n.id}`, owner)
      ).json();
      expect(filtered.totals).toMatchObject({ requests: 1, chargedMicros: '500' });
      expect(filtered.byProject).toMatchObject([{ name: 'App', chargedMicros: '500' }]);

      const csv = await call('GET', `/internal/organizations/${orgId}/usage.csv`, owner);
      expect(csv.headers['content-type']).toContain('text/csv');
      expect(csv.headers['content-disposition']).toContain('attachment');
      expect(csv.body.charCodeAt(0)).toBe(0xfeff);
      expect(csv.body).toContain('fuse/a');
      expect(csv.body).toContain('0.000300');

      const p1 = (await call('GET', `/internal/organizations/${orgId}/logs?limit=2`, owner)).json();
      expect(p1.items).toHaveLength(2);
      const p2 = (
        await call(
          'GET',
          `/internal/organizations/${orgId}/logs?limit=2&cursor=${p1.nextCursor}`,
          owner,
        )
      ).json();
      expect(p2.items).toHaveLength(2);
      expect(p2.nextCursor).toBeNull();
      expect(p1.items[0]).toMatchObject({ project: 'App' });
      const errors = (
        await call('GET', `/internal/organizations/${orgId}/logs?status=UPSTREAM_ERROR`, owner)
      ).json();
      expect(errors.items).toMatchObject([{ model: 'fuse/b', errorCode: 'upstream_error' }]);
    });

    it('exports the ledger as CSV, neutralizing formulas in descriptions', async () => {
      const admin = await createUserSession(ctx.app, 'admin@example.com', 'SUPER_ADMIN');
      await call('POST', `/internal/admin/organizations/${orgId}/wallet/adjust`, admin, {
        amountMicros: '1500000',
        reason: '=HYPERLINK("http://evil")',
      });
      const csv = await call('GET', `/internal/organizations/${orgId}/wallet/ledger.csv`, owner);
      expect(csv.statusCode).toBe(200);
      expect(csv.body).toContain('ADJUSTMENT');
      expect(csv.body).toContain('1.500000');
      expect(csv.body).toContain(`"'=HYPERLINK(""http://evil"")"`);
    });

    it('keeps analytics private to members', async () => {
      const stranger = await createUserSession(ctx.app, 'outro@example.com');
      for (const path of [
        'overview',
        'usage',
        'usage.csv',
        'logs',
        'wallet/ledger.csv',
        'models',
        'members',
      ]) {
        expect(
          (await call('GET', `/internal/organizations/${orgId}/${path}`, stranger)).statusCode,
        ).toBe(404);
      }
    });
  });

  describe('project settings', () => {
    it('updates settings and validates models and origins', async () => {
      const m = await seedModel();
      const ok = await call('PATCH', `/internal/projects/${projectId}`, owner, {
        name: 'App Novo',
        allowedOrigins: [
          'https://app.cliente.com',
          'http://localhost:5173',
          'https://app.cliente.com',
        ],
        allowedModelIds: [m.id],
        defaultModelId: m.id,
        freeCreditMicros: '2000000',
        webhookUrl: 'https://cliente.com/hooks/fuse',
      });
      expect(ok.statusCode).toBe(200);
      expect(ok.json()).toMatchObject({
        name: 'App Novo',
        allowedOrigins: ['https://app.cliente.com', 'http://localhost:5173'],
        allowedModelIds: [m.id],
        freeCreditMicros: '2000000',
      });

      expect(
        (
          await call('PATCH', `/internal/projects/${projectId}`, owner, {
            allowedModelIds: ['nope'],
          })
        ).statusCode,
      ).toBe(400);
      expect(
        (
          await call('PATCH', `/internal/projects/${projectId}`, owner, {
            allowedOrigins: ['https://x.com/path'],
          })
        ).statusCode,
      ).toBe(400);
      const other = await seedModel('fuse/other');
      const badDefault = await call('PATCH', `/internal/projects/${projectId}`, owner, {
        defaultModelId: other.id,
      });
      expect(badDefault.statusCode).toBe(400);
    });

    it('rotates and reveals an encrypted webhook secret', async () => {
      const rotated = (
        await call('POST', `/internal/projects/${projectId}/webhook-secret/rotate`, owner)
      ).json();
      expect(rotated.secret).toMatch(/^whsec_/);
      const stored = await prisma.project.findUniqueOrThrow({ where: { id: projectId } });
      expect(stored.webhookSecret).not.toContain(rotated.secret);
      const revealed = (
        await call('GET', `/internal/projects/${projectId}/webhook-secret`, owner)
      ).json();
      expect(revealed.secret).toBe(rotated.secret);
    });

    it('updates organization settings and drops the Asaas customer when the document changes', async () => {
      await prisma.organization.update({
        where: { id: orgId },
        data: { asaasCustomerId: 'cus_1' },
      });
      const res = await call('PATCH', `/internal/organizations/${orgId}`, owner, {
        document: '11.222.333/0001-81',
        lowBalanceAlertMicros: '20000000',
        suggestedTopupCents: 10000,
      });
      expect(res.statusCode).toBe(200);
      const org = await prisma.organization.findUniqueOrThrow({ where: { id: orgId } });
      expect(org).toMatchObject({
        document: '11222333000181',
        asaasCustomerId: null,
        lowBalanceAlertMicros: 20_000_000n,
        suggestedTopupCents: 10000,
      });
      const detail = (await call('GET', `/internal/organizations/${orgId}`, owner)).json();
      expect(detail).toMatchObject({ role: 'OWNER', lowBalanceAlertMicros: '20000000' });
    });
  });

  describe('team', () => {
    async function invite(email: string, role = 'DEVELOPER', as = owner) {
      const res = await call('POST', `/internal/organizations/${orgId}/invitations`, as, {
        email,
        role,
      });
      const mail = ctx.mailer.sent.at(-1);
      const token = mail?.text.match(/\/convite\/([\w-]+)/)?.[1];
      return { res, token };
    }

    it('invites by email and lets the right person accept', async () => {
      const { res, token } = await invite('Dev@Example.com');
      expect(res.statusCode).toBe(201);
      expect(res.json()).toMatchObject({ email: 'dev@example.com', role: 'DEVELOPER' });
      expect(token).toBeTruthy();
      const stored = await prisma.invitation.findFirstOrThrow();
      expect(stored.tokenHash).not.toBe(token);

      const wrong = await createUserSession(ctx.app, 'intruso@example.com');
      const denied = await call('POST', `/internal/invitations/${token}/accept`, wrong);
      expect(denied.statusCode).toBe(403);

      const dev = await createUserSession(ctx.app, 'dev@example.com');
      const info = (await call('GET', `/internal/invitations/${token}`, dev)).json();
      expect(info).toMatchObject({ orgName: 'Org Um', state: 'pending', emailMatches: true });
      const accepted = await call('POST', `/internal/invitations/${token}/accept`, dev);
      expect(accepted.json()).toMatchObject({ orgId, role: 'DEVELOPER' });
      expect((await call('POST', `/internal/invitations/${token}/accept`, dev)).statusCode).toBe(
        410,
      );

      const members = (await call('GET', `/internal/organizations/${orgId}/members`, owner)).json();
      expect(
        members.members.map((m: { email: string; role: string }) => [m.email, m.role]),
      ).toEqual([
        ['dono@example.com', 'OWNER'],
        ['dev@example.com', 'DEVELOPER'],
      ]);
      expect(members.invitations).toHaveLength(0);

      // The new member sees the org and its wallet.
      expect((await call('GET', `/internal/organizations/${orgId}/wallet`, dev)).statusCode).toBe(
        200,
      );
    });

    it('rejects expired invitations and members already in the team', async () => {
      const { token } = await invite('late@example.com');
      await prisma.invitation.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
      const late = await createUserSession(ctx.app, 'late@example.com');
      expect((await call('POST', `/internal/invitations/${token}/accept`, late)).statusCode).toBe(
        410,
      );
      expect((await invite('dono@example.com')).res.statusCode).toBe(409);
    });

    it('protects owners: last-owner rule, admins cannot touch owners, members cannot manage', async () => {
      // Owner cannot leave or be demoted while being the only owner.
      const me = await prisma.user.findUniqueOrThrow({ where: { email: 'dono@example.com' } });
      expect(
        (await call('DELETE', `/internal/organizations/${orgId}/members/${me.id}`, owner))
          .statusCode,
      ).toBe(409);
      expect(
        (
          await call('PATCH', `/internal/organizations/${orgId}/members/${me.id}`, owner, {
            role: 'ADMIN',
          })
        ).statusCode,
      ).toBe(409);

      // An ADMIN can invite developers but cannot invite owners nor change the owner.
      const { token } = await invite('admin@empresa.com', 'ADMIN');
      const admin = await createUserSession(ctx.app, 'admin@empresa.com');
      await call('POST', `/internal/invitations/${token}/accept`, admin);
      expect((await invite('novo@empresa.com', 'OWNER', admin)).res.statusCode).toBe(403);
      expect((await invite('novo@empresa.com', 'BILLING', admin)).res.statusCode).toBe(201);
      expect(
        (
          await call('PATCH', `/internal/organizations/${orgId}/members/${me.id}`, admin, {
            role: 'DEVELOPER',
          })
        ).statusCode,
      ).toBe(403);
      expect(
        (await call('DELETE', `/internal/organizations/${orgId}/members/${me.id}`, admin))
          .statusCode,
      ).toBe(403);

      // A DEVELOPER cannot manage the team.
      const { token: t2 } = await invite('dev2@empresa.com');
      await signUp(ctx.app, 'dev2@empresa.com');
      await prisma.user.update({
        where: { email: 'dev2@empresa.com' },
        data: { emailVerified: true },
      });
      const dev = (await signIn(ctx.app, 'dev2@empresa.com')).cookie;
      await call('POST', `/internal/invitations/${t2}/accept`, dev);
      expect((await invite('x@empresa.com', 'DEVELOPER', dev)).res.statusCode).toBe(403);

      // A promoted second owner lets the first one leave.
      const adminUser = await prisma.user.findUniqueOrThrow({
        where: { email: 'admin@empresa.com' },
      });
      await call('PATCH', `/internal/organizations/${orgId}/members/${adminUser.id}`, owner, {
        role: 'OWNER',
      });
      expect(
        (await call('DELETE', `/internal/organizations/${orgId}/members/${me.id}`, owner))
          .statusCode,
      ).toBe(204);
    });
  });
});
