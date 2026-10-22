import type { PrismaClient } from '@fusai/db';

/** Days between the request and the anonymization; the user can cancel meanwhile. */
export const DELETION_GRACE_DAYS = 7;
const DAY_MS = 86_400_000;

export type DeletionBlocker = { code: string; message: string };

export function deletionScheduledFor(requestedAt: Date): Date {
  return new Date(requestedAt.getTime() + DELETION_GRACE_DAYS * DAY_MS);
}

/**
 * Reasons the account cannot be deleted yet. Money is never erased: an organization the user is
 * the only owner of must have no balance, no pending Pix and no end users with credits.
 */
export async function deletionBlockers(
  prisma: PrismaClient,
  userId: string,
): Promise<DeletionBlocker[]> {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { role: true },
  });
  const blockers: DeletionBlocker[] = [];
  if (user.role === 'SUPER_ADMIN') {
    blockers.push({
      code: 'super_admin',
      message: 'Contas de super admin não podem ser excluídas pelo painel.',
    });
  }

  for (const org of await soleOwnedOrgs(prisma, userId)) {
    const label = `"${org.name}"`;
    if (org.memberCount > 1) {
      blockers.push({
        code: 'org_has_members',
        message: `Você é o único dono de ${label}: passe a propriedade para outra pessoa da equipe ou remova os membros.`,
      });
    }
    if ((org.wallet?.balanceMicros ?? 0n) > 0n || (org.wallet?.reservedMicros ?? 0n) > 0n) {
      blockers.push({
        code: 'org_balance',
        message: `${label} ainda tem saldo. Use os créditos ou peça o estorno antes de excluir a conta.`,
      });
    }
    const pending = await prisma.payment.count({ where: { orgId: org.id, status: 'PENDING' } });
    if (pending > 0) {
      blockers.push({
        code: 'pending_payments',
        message: `${label} tem Pix aguardando pagamento. Espere vencer ou pagar.`,
      });
    }
    const endUsersWithCredits = await prisma.wallet.count({
      where: { appUser: { project: { orgId: org.id } }, balanceMicros: { gt: 0n } },
    });
    if (endUsersWithCredits > 0) {
      blockers.push({
        code: 'end_user_balance',
        message: `Usuários finais dos projetos de ${label} ainda têm créditos.`,
      });
    }
  }
  return blockers;
}

/** Organizations where this user is the only OWNER (they would be left without an owner). */
async function soleOwnedOrgs(prisma: PrismaClient, userId: string) {
  const owned = await prisma.membership.findMany({
    where: { userId, role: 'OWNER' },
    select: {
      org: {
        select: {
          id: true,
          name: true,
          wallet: { select: { balanceMicros: true, reservedMicros: true } },
          members: { select: { userId: true, role: true } },
        },
      },
    },
  });
  return owned
    .map(({ org }) => org)
    .filter((org) => !org.members.some((m) => m.role === 'OWNER' && m.userId !== userId))
    .map((org) => ({ ...org, memberCount: org.members.length }));
}

/**
 * Anonymizes accounts whose grace period ended. Payments, ledger and usage are kept (legal and
 * accounting obligations) but stop pointing to a person: name and email are replaced, logins and
 * sessions are deleted, and the organizations the user owned alone are suspended with their keys
 * revoked. Accounts that became blocked in the meantime (e.g. a new balance) are skipped and
 * retried once a day, so they never starve the rest of the queue.
 */
export async function anonymizeDueAccounts(prisma: PrismaClient, now = new Date()) {
  const recentlyBlocked = await prisma.auditLog.findMany({
    where: {
      action: 'privacy.deletion_blocked',
      createdAt: { gt: new Date(now.getTime() - DAY_MS) },
      target: { not: null },
    },
    select: { target: true },
  });
  const due = await prisma.user.findMany({
    where: {
      deletionRequestedAt: { lte: new Date(now.getTime() - DELETION_GRACE_DAYS * DAY_MS) },
      deletedAt: null,
      id: { notIn: recentlyBlocked.map((row) => row.target as string) },
    },
    select: { id: true },
    orderBy: { deletionRequestedAt: 'asc' },
    take: 50,
  });
  const result = { anonymized: [] as string[], blocked: [] as string[] };
  for (const { id } of due) {
    const blockers = await deletionBlockers(prisma, id);
    if (blockers.length > 0) {
      await prisma.auditLog.create({
        data: {
          action: 'privacy.deletion_blocked',
          target: id,
          metadata: { blockers: blockers.map((b) => b.code) },
          createdAt: now,
        },
      });
      result.blocked.push(id);
      continue;
    }
    await anonymizeUser(prisma, id, now);
    result.anonymized.push(id);
  }
  return result;
}

async function anonymizeUser(prisma: PrismaClient, userId: string, now: Date) {
  const orgs = await soleOwnedOrgs(prisma, userId);
  await prisma.$transaction(async (tx) => {
    const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
    for (const org of orgs) {
      await tx.organization.update({
        where: { id: org.id },
        data: { status: 'SUSPENDED', phone: null },
      });
      await tx.apiKey.updateMany({
        where: { project: { orgId: org.id }, revokedAt: null },
        data: { revokedAt: now },
      });
      await tx.agentKey.updateMany({
        where: { orgId: org.id, revokedAt: null },
        data: { revokedAt: now },
      });
      await tx.invitation.deleteMany({ where: { orgId: org.id, acceptedAt: null } });
    }
    await tx.membership.deleteMany({ where: { userId } });
    await tx.invitation.deleteMany({ where: { email: user.email, acceptedAt: null } });
    await tx.session.deleteMany({ where: { userId } });
    await tx.account.deleteMany({ where: { userId } });
    await tx.twoFactor.deleteMany({ where: { userId } });
    await tx.verification.deleteMany({
      where: { OR: [{ identifier: user.email }, { value: userId }, { value: user.email }] },
    });
    await tx.user.update({
      where: { id: userId },
      data: {
        name: 'Conta excluída',
        email: `excluido-${userId}@anonimizado.invalid`,
        emailVerified: false,
        image: null,
        twoFactorEnabled: false,
        banned: true,
        banReason: 'account_deleted',
        deletedAt: now,
      },
    });
    await tx.auditLog.create({
      data: {
        actorId: null,
        action: 'privacy.account_anonymized',
        target: userId,
        metadata: { suspendedOrgIds: orgs.map((o) => o.id) },
      },
    });
  });
}
