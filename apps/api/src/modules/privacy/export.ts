import type { PrismaClient } from '@fusai/db';

/**
 * LGPD data export (art. 18, II and V): what the fusai stores about the signed-in user and the
 * organizations they own. Never includes hashes, secrets, tokens, provider keys or other
 * organizations. End users of the customer's apps are only counted: the customer is their
 * controller and already sees them in the dashboard.
 */
export async function buildDataExport(prisma: PrismaClient, userId: string) {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      email: true,
      emailVerified: true,
      image: true,
      createdAt: true,
      updatedAt: true,
      deletionRequestedAt: true,
      sessions: {
        select: { createdAt: true, expiresAt: true, ipAddress: true, userAgent: true },
        orderBy: { createdAt: 'desc' },
      },
      accounts: { select: { providerId: true, createdAt: true } },
      memberships: {
        select: { role: true, org: { select: { id: true, name: true, slug: true } } },
      },
    },
  });

  const ownedIds = user.memberships.filter((m) => m.role === 'OWNER').map((m) => m.org.id);
  const organizations = await Promise.all(ownedIds.map((id) => exportOrganization(prisma, id)));

  const activity = await prisma.auditLog.findMany({
    where: { actorId: userId },
    select: { action: true, target: true, ip: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
    take: 5_000,
  });

  const { sessions, accounts, memberships, ...profile } = user;
  return {
    format: 'fusai-data-export/1',
    generatedAt: new Date().toISOString(),
    profile,
    logins: accounts.map((a) => ({
      method: a.providerId === 'credential' ? 'email e senha' : a.providerId,
      createdAt: a.createdAt,
    })),
    sessions,
    memberships: memberships.map((m) => ({ role: m.role, organization: m.org })),
    ownedOrganizations: organizations,
    activity,
  };
}

async function exportOrganization(prisma: PrismaClient, orgId: string) {
  const org = await prisma.organization.findUniqueOrThrow({
    where: { id: orgId },
    select: {
      id: true,
      name: true,
      slug: true,
      document: true,
      phone: true,
      status: true,
      billingType: true,
      lowBalanceAlertMicros: true,
      suggestedTopupCents: true,
      createdAt: true,
      wallet: { select: { id: true, balanceMicros: true, reservedMicros: true } },
      members: {
        select: { role: true, user: { select: { name: true, email: true } } },
      },
      invitations: {
        select: {
          email: true,
          role: true,
          createdAt: true,
          expiresAt: true,
          acceptedAt: true,
          revokedAt: true,
        },
      },
      agentKeys: {
        select: { name: true, prefix: true, lastUsedAt: true, revokedAt: true, createdAt: true },
      },
      projects: {
        select: {
          id: true,
          name: true,
          slug: true,
          billingMode: true,
          allowedOrigins: true,
          webhookUrl: true,
          freeCreditMicros: true,
          createdAt: true,
          apiKeys: {
            select: {
              name: true,
              prefix: true,
              env: true,
              scopes: true,
              spendLimitMicros: true,
              rpmLimit: true,
              lastUsedAt: true,
              expiresAt: true,
              revokedAt: true,
              createdAt: true,
            },
          },
          _count: { select: { appUsers: true } },
        },
      },
      payments: {
        select: {
          id: true,
          status: true,
          amountCents: true,
          creditMicros: true,
          projectId: true,
          createdAt: true,
          paidAt: true,
        },
        orderBy: { createdAt: 'desc' },
      },
    },
  });

  const ledger = org.wallet
    ? await prisma.ledgerEntry.findMany({
        where: { walletId: org.wallet.id },
        select: {
          type: true,
          amountMicros: true,
          balanceAfter: true,
          description: true,
          referenceType: true,
          referenceId: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
      })
    : [];

  const usage = await prisma.$queryRaw<
    {
      month: string;
      modelId: string;
      requests: bigint;
      promptTokens: bigint;
      completionTokens: bigint;
      chargedMicros: bigint;
    }[]
  >`
    SELECT to_char(date_trunc('month', "createdAt"), 'YYYY-MM') AS month, "modelId",
           COUNT(*) AS requests, SUM("promptTokens") AS "promptTokens",
           SUM("completionTokens") AS "completionTokens", SUM("chargedMicros") AS "chargedMicros"
    FROM "UsageLog" WHERE "orgId" = ${orgId}
    GROUP BY 1, 2 ORDER BY 1 DESC, 2`;

  const { wallet, projects, ...rest } = org;
  return {
    ...rest,
    wallet: wallet
      ? { balanceMicros: wallet.balanceMicros, reservedMicros: wallet.reservedMicros }
      : null,
    projects: projects.map(({ _count, ...p }) => ({ ...p, endUserCount: _count.appUsers })),
    ledger,
    usageByMonth: usage,
  };
}

/** JSON with BigInt as decimal strings (money stays exact). */
export function exportToJson(data: unknown): string {
  return JSON.stringify(data, (_k, v) => (typeof v === 'bigint' ? v.toString() : v), 2);
}
