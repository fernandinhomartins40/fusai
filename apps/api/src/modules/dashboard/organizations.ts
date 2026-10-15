import { randomBytes } from 'node:crypto';
import type { BillingMode, PrismaClient } from '@fusai/db';
import { slugify } from '@fusai/shared';
import type { SettingsStore } from '../../lib/settings';
import { applyLedger } from '../billing/wallet';
import { requireMembership } from './membership';

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
  settings: SettingsStore,
) {
  const welcomeBonus = BigInt((await settings.get()).welcome_bonus_micros);
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
    const wallet = await tx.wallet.create({ data: { ownerType: 'ORGANIZATION', orgId: org.id } });
    if (welcomeBonus > 0n) {
      await applyLedger(tx, {
        walletId: wallet.id,
        type: 'BONUS',
        amountMicros: welcomeBonus,
        referenceType: 'welcome',
        referenceId: org.id,
        description: 'Bônus de boas-vindas',
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
  await requireMembership(prisma, userId, orgId, ['OWNER', 'ADMIN', 'DEVELOPER']);

  const slug = await uniqueSlug(
    input.name,
    async (s) => (await prisma.project.count({ where: { orgId, slug: s } })) > 0,
  );
  return prisma.project.create({
    data: { orgId, name: input.name, slug, billingMode: input.billingMode },
  });
}
