import { randomBytes } from 'node:crypto';
import type { BillingMode, PrismaClient } from '@fuseai/db';
import { slugify } from '@fuseai/shared';
import { forbidden, notFound } from '../../lib/errors';
import { getBigIntSetting } from '../../lib/settings';

const PROJECT_EDITOR_ROLES = new Set(['OWNER', 'ADMIN', 'DEVELOPER']);

async function uniqueSlug(base: string, exists: (slug: string) => Promise<boolean>) {
  const root = slugify(base) || 'org';
  if (!(await exists(root))) return root;
  for (let i = 0; i < 5; i++) {
    const candidate = `${root.slice(0, 40)}-${randomBytes(3).toString('hex')}`;
    if (!(await exists(candidate))) return candidate;
  }
  throw new Error('Could not generate a unique slug');
}

/** Creates an organization with its wallet and the user as OWNER (+ optional welcome bonus). */
export async function createOrganization(
  prisma: PrismaClient,
  userId: string,
  input: { name: string; document: string; phone: string },
) {
  const welcomeBonus = await getBigIntSetting(prisma, 'welcome_bonus_micros', 0n);
  const slug = await uniqueSlug(
    input.name,
    async (s) => (await prisma.organization.count({ where: { slug: s } })) > 0,
  );

  return prisma.$transaction(async (tx) => {
    const org = await tx.organization.create({
      data: {
        name: input.name,
        slug,
        document: input.document,
        phone: input.phone,
        members: { create: { userId, role: 'OWNER' } },
      },
    });
    const wallet = await tx.wallet.create({
      data: { ownerType: 'ORGANIZATION', orgId: org.id, balanceMicros: welcomeBonus },
    });
    if (welcomeBonus > 0n) {
      await tx.ledgerEntry.create({
        data: {
          walletId: wallet.id,
          type: 'BONUS',
          amountMicros: welcomeBonus,
          balanceAfter: welcomeBonus,
          referenceType: 'admin',
          description: 'Bônus de boas-vindas',
        },
      });
    }
    return org;
  });
}

export async function createProject(
  prisma: PrismaClient,
  userId: string,
  orgId: string,
  input: { name: string; billingMode: BillingMode },
) {
  const membership = await prisma.membership.findUnique({
    where: { userId_orgId: { userId, orgId } },
  });
  if (!membership) throw notFound('Organização não encontrada');
  if (!PROJECT_EDITOR_ROLES.has(membership.role))
    throw forbidden('Sem permissão para criar projetos');

  const slug = await uniqueSlug(
    input.name,
    async (s) => (await prisma.project.count({ where: { orgId, slug: s } })) > 0,
  );
  return prisma.project.create({
    data: { orgId, name: input.name, slug, billingMode: input.billingMode },
  });
}
