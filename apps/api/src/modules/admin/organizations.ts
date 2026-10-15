import type { Prisma, PrismaClient } from '@fusai/db';
import { ledgerQuerySchema, onlyDigits, orgSearchSchema, walletAdjustSchema } from '@fusai/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { audit } from '../../lib/audit';
import { notFound } from '../../lib/errors';
import { currentUser } from '../../lib/session';
import {
  applyLedger,
  creditLimitFor,
  ledgerSum,
  listLedger,
  walletSummary,
} from '../billing/wallet';

const idParams = z.object({ id: z.string().min(1) });

/** Customers (organizations): list, detail, statement and manual balance adjustment. */
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
    const sum = await ledgerSum(prisma, wallet.id);
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
      const entry = await prisma.$transaction((tx) =>
        applyLedger(tx, {
          walletId: wallet.id,
          type: 'ADJUSTMENT',
          amountMicros,
          referenceType: 'admin',
          description: req.body.reason,
          actorId: actor.id,
        }),
      );
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
};
