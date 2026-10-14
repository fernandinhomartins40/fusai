import type { OrgRole, PrismaClient } from '@fuseai/db';
import { forbidden, notFound } from '../../lib/errors';

/**
 * Ensures the user belongs to the organization (404 otherwise, so ids of other
 * organizations are not confirmed) and optionally has one of `roles` (403).
 */
export async function requireMembership(
  prisma: PrismaClient,
  userId: string,
  orgId: string,
  roles?: readonly OrgRole[],
) {
  const membership = await prisma.membership.findUnique({
    where: { userId_orgId: { userId, orgId } },
  });
  if (!membership) throw notFound('Organização não encontrada');
  if (roles && !roles.includes(membership.role)) throw forbidden('Sem permissão para esta ação');
  return membership;
}
