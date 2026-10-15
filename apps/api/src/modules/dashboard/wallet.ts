import type { PrismaClient } from '@fusai/db';
import { ledgerQuerySchema } from '@fusai/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { notFound } from '../../lib/errors';
import { currentUser } from '../../lib/session';
import { creditLimitFor, listLedger, walletSummary } from '../billing/wallet';
import { requireMembership } from './membership';

const orgParams = z.object({ orgId: z.string().min(1) });

/** Organization wallet and statement for any member (registered inside the dashboard plugin). */
export const dashboardWalletRoutes: FastifyPluginAsyncZod<{ prisma: PrismaClient }> = async (
  app,
  { prisma },
) => {
  async function orgWallet(userId: string, orgId: string) {
    await requireMembership(prisma, userId, orgId);
    const org = await prisma.organization.findUnique({
      where: { id: orgId },
      include: { wallet: true },
    });
    if (!org?.wallet) throw notFound('Carteira não encontrada');
    return { org, wallet: org.wallet };
  }

  app.get(
    '/internal/organizations/:orgId/wallet',
    { schema: { params: orgParams } },
    async (req) => {
      const { org, wallet } = await orgWallet(currentUser(req).id, req.params.orgId);
      return {
        ...walletSummary(wallet),
        billingType: org.billingType,
        creditLimitMicros: creditLimitFor(org).toString(),
      };
    },
  );

  app.get(
    '/internal/organizations/:orgId/wallet/ledger',
    { schema: { params: orgParams, querystring: ledgerQuerySchema } },
    async (req) => {
      const { wallet } = await orgWallet(currentUser(req).id, req.params.orgId);
      return listLedger(prisma, wallet.id, req.query);
    },
  );
};
