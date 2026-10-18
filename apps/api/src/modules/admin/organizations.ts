import type { Prisma, PrismaClient } from '@fusai/db';
import {
  ledgerQuerySchema,
  onlyDigits,
  orgAdminUpdateSchema,
  orgSearchSchema,
  walletAdjustSchema,
} from '@fusai/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { audit } from '../../lib/audit';
import { HttpError, notFound } from '../../lib/errors';
import { currentUser } from '../../lib/session';
import { addDays, startOfSpDay } from '../../lib/time';
import {
  applyLedger,
  creditLimitFor,
  ledgerSum,
  listLedger,
  walletSummary,
} from '../billing/wallet';

const idParams = z.object({ id: z.string().min(1) });

/**
 * Customers (organizations): list, detail, statement, manual balance adjustment, account
 * settings (status, billing type, credit limit, special markup) and their API keys.
 */
export const adminOrganizationRoutes: FastifyPluginAsyncZod<{ prisma: PrismaClient }> = async (
  app,
  { prisma },
) => {
  async function findOrg(id: string) {
    const org = await prisma.organization.findUnique({
      where: { id },
      include: {
        wallet: { include: { _count: { select: { holds: true } } } },
        members: { include: { user: { select: { id: true, name: true, email: true } } } },
        projects: {
          select: { id: true, name: true, slug: true, billingMode: true, createdAt: true },
        },
      },
    });
    if (!org) throw notFound('Cliente não encontrado');
    return org;
  }

  /** Creates the wallet if an older organization does not have one yet. */
  async function ensureWallet(orgId: string) {
    return prisma.wallet.upsert({
      where: { orgId },
      update: {},
      create: { ownerType: 'ORGANIZATION', orgId },
    });
  }

  app.get(
    '/internal/admin/organizations',
    { schema: { querystring: orgSearchSchema } },
    async (req) => {
      const { q, cursor } = req.query;
      const limit = req.query.limit ?? 30;
      const digits = q ? onlyDigits(q) : '';
      const where: Prisma.OrganizationWhereInput = q
        ? {
            OR: [
              { name: { contains: q, mode: 'insensitive' } },
              { slug: { contains: q.toLowerCase() } },
              ...(digits.length >= 3 ? [{ document: { contains: digits } }] : []),
              { members: { some: { user: { email: { contains: q, mode: 'insensitive' } } } } },
            ],
          }
        : {};
      const rows = await prisma.organization.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        include: { wallet: true, _count: { select: { members: true, projects: true } } },
      });
      const page = rows.slice(0, limit);
      return {
        items: page.map((o) => ({
          id: o.id,
          name: o.name,
          slug: o.slug,
          document: o.document,
          status: o.status,
          billingType: o.billingType,
          members: o._count.members,
          projects: o._count.projects,
          balanceMicros: (o.wallet?.balanceMicros ?? 0n).toString(),
          reservedMicros: (o.wallet?.reservedMicros ?? 0n).toString(),
          createdAt: o.createdAt.toISOString(),
        })),
        nextCursor: rows.length > limit ? (page.at(-1)?.id ?? null) : null,
      };
    },
  );

  app.get('/internal/admin/organizations/:id', { schema: { params: idParams } }, async (req) => {
    const org = await findOrg(req.params.id);
    const wallet = org.wallet ?? (await ensureWallet(org.id));
    const since = addDays(startOfSpDay(), -29);
    const [sum, usage] = await Promise.all([
      ledgerSum(prisma, wallet.id),
      prisma.usageLog.aggregate({
        where: { orgId: org.id, createdAt: { gte: since } },
        _count: { _all: true },
        _sum: { chargedMicros: true, costBrlMicros: true },
      }),
    ]);
    return {
      id: org.id,
      name: org.name,
      slug: org.slug,
      document: org.document,
      phone: org.phone,
      status: org.status,
      billingType: org.billingType,
      creditLimitMicros: creditLimitFor(org).toString(),
      markupOverride: org.markupOverride?.toFixed() ?? null,
      createdAt: org.createdAt.toISOString(),
      usage30d: {
        requests: usage._count._all,
        chargedMicros: (usage._sum.chargedMicros ?? 0n).toString(),
        costMicros: (usage._sum.costBrlMicros ?? 0n).toString(),
      },
      members: org.members.map((m) => ({ role: m.role, ...m.user })),
      projects: org.projects.map((p) => ({ ...p, createdAt: p.createdAt.toISOString() })),
      wallet: {
        ...walletSummary(wallet),
        activeHolds: org.wallet?._count.holds ?? 0,
        ledgerSumMicros: sum.toString(),
        consistent: sum === wallet.balanceMicros,
      },
    };
  });

  app.get(
    '/internal/admin/organizations/:id/ledger',
    { schema: { params: idParams, querystring: ledgerQuerySchema } },
    async (req) => {
      const wallet = await ensureWallet((await findOrg(req.params.id)).id);
      return listLedger(prisma, wallet.id, req.query);
    },
  );

  app.post(
    '/internal/admin/organizations/:id/wallet/adjust',
    { schema: { params: idParams, body: walletAdjustSchema } },
    async (req, reply) => {
      const org = await findOrg(req.params.id);
      const wallet = await ensureWallet(org.id);
      const amountMicros = BigInt(req.body.amountMicros);
      const actor = currentUser(req);
      const entry = await prisma.$transaction(async (tx) => {
        const e = await applyLedger(tx, {
          walletId: wallet.id,
          type: 'ADJUSTMENT',
          amountMicros,
          referenceType: 'admin',
          description: req.body.reason,
          actorId: actor.id,
        });
        // A debit never leaves the customer owing (D-128): at most what is available.
        if (amountMicros < 0n) {
          const w = await tx.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
          if (e.balanceAfter - w.reservedMicros + creditLimitFor(org) < 0n) {
            throw new HttpError(
              400,
              'insufficient_balance',
              'O débito é maior que o saldo disponível do cliente.',
            );
          }
        }
        return e;
      });
      await audit(prisma, req, 'wallet.adjust', org.id, {
        walletId: wallet.id,
        ledgerEntryId: entry.id,
        amountMicros: amountMicros.toString(),
        balanceAfter: entry.balanceAfter.toString(),
        reason: req.body.reason,
      });
      return reply.status(201).send({
        id: entry.id,
        type: entry.type,
        amountMicros: entry.amountMicros.toString(),
        balanceAfter: entry.balanceAfter.toString(),
        description: entry.description,
        createdAt: entry.createdAt.toISOString(),
      });
    },
  );

  app.patch(
    '/internal/admin/organizations/:id',
    { schema: { params: idParams, body: orgAdminUpdateSchema } },
    async (req) => {
      const org = await findOrg(req.params.id);
      const { reason, creditLimitMicros, markupOverride, ...rest } = req.body;
      // Owner's rule (D-128): prepaid only, nobody consumes on credit.
      if (
        rest.billingType === 'POSTPAID' ||
        (creditLimitMicros && BigInt(creditLimitMicros) > 0n)
      ) {
        throw new HttpError(
          400,
          'postpaid_disabled',
          'Pós-pago está desativado: os clientes só consomem o saldo que já pagaram.',
        );
      }
      const data: Prisma.OrganizationUpdateInput = {
        ...rest,
        ...(creditLimitMicros !== undefined
          ? { creditLimitMicros: BigInt(creditLimitMicros) }
          : {}),
        ...(markupOverride !== undefined ? { markupOverride } : {}),
      };
      if (Object.keys(data).length === 0) {
        throw new HttpError(400, 'invalid_request', 'Nada para alterar');
      }
      const updated = await prisma.organization.update({ where: { id: org.id }, data });
      const changes = {
        ...rest,
        ...(creditLimitMicros !== undefined ? { creditLimitMicros } : {}),
        ...(markupOverride !== undefined ? { markupOverride } : {}),
      };
      const action =
        rest.status && rest.status !== org.status
          ? rest.status === 'SUSPENDED'
            ? 'org.suspend'
            : 'org.reactivate'
          : 'org.update';
      await audit(prisma, req, action, org.id, {
        before: {
          status: org.status,
          billingType: org.billingType,
          creditLimitMicros: org.creditLimitMicros.toString(),
          markupOverride: org.markupOverride?.toFixed() ?? null,
        },
        changes,
        ...(reason ? { reason } : {}),
      });
      return {
        id: updated.id,
        status: updated.status,
        billingType: updated.billingType,
        creditLimitMicros: updated.creditLimitMicros.toString(),
        markupOverride: updated.markupOverride?.toFixed() ?? null,
      };
    },
  );

  /** Every API key of the customer's projects (prefix only: the secret is never stored). */
  app.get(
    '/internal/admin/organizations/:id/api-keys',
    { schema: { params: idParams } },
    async (req) => {
      const org = await findOrg(req.params.id);
      const keys = await prisma.apiKey.findMany({
        where: { project: { orgId: org.id } },
        orderBy: [{ revokedAt: { sort: 'desc', nulls: 'first' } }, { createdAt: 'desc' }],
        include: { project: { select: { id: true, name: true } } },
      });
      return {
        items: keys.map((k) => ({
          id: k.id,
          name: k.name,
          prefix: k.prefix,
          env: k.env,
          scopes: k.scopes,
          project: k.project,
          lastUsedAt: k.lastUsedAt?.toISOString() ?? null,
          expiresAt: k.expiresAt?.toISOString() ?? null,
          revokedAt: k.revokedAt?.toISOString() ?? null,
          createdAt: k.createdAt.toISOString(),
        })),
      };
    },
  );

  app.post('/internal/admin/api-keys/:id/revoke', { schema: { params: idParams } }, async (req) => {
    const key = await prisma.apiKey.findUnique({
      where: { id: req.params.id },
      include: { project: { select: { orgId: true } } },
    });
    if (!key) throw notFound('Chave não encontrada');
    if (!key.revokedAt) {
      await prisma.apiKey.update({ where: { id: key.id }, data: { revokedAt: new Date() } });
      await audit(prisma, req, 'api_key.revoke', key.id, {
        orgId: key.project.orgId,
        prefix: key.prefix,
        byAdmin: true,
      });
    }
    return { revoked: true };
  });
};
