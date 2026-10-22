import { randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient, type Project } from '@fusai/db';
import { onlyDigits } from '@fusai/shared';
import { signJwt, verifyJwt } from '../../lib/jwt';
import { applyLedger, type Tx, transferCredits } from '../billing/wallet';

export const SESSION_TOKEN_PREFIX = 'fai_st_';
export const SESSION_TTL_SECONDS = 15 * 60;
export const SESSION_SCOPES = ['chat', 'checkout', 'balance'] as const;

export type SessionClaims = {
  sub: string; // appUserId
  pid: string; // projectId
  scp: string[];
  iat: number;
  exp: number;
  jti: string;
  /** API key that issued the token: its monthly spend limit also covers this end user. */
  kid?: string;
};

export type AppUserInput = { externalId: string; email?: string; name?: string; document?: string };

export type EndUserCredit = {
  orgId: string;
  walletId: string;
  amountMicros: bigint;
  referenceType: string;
  referenceId: string;
  description: string;
  actorId?: string | null;
};

/**
 * Credit an organization gives to one of its end users (free credit, courtesy, package bonus).
 * PIE R-01 (owner's rule): the organization pays for it, as a transfer from its own wallet.
 * Returns false when the organization does not have that much available. INTERNAL
 * organizations are fusai's own: their end users get the credit without a transfer.
 */
export async function giveEndUserCredit(tx: Tx, credit: EndUserCredit): Promise<boolean> {
  const org = await tx.organization.findUniqueOrThrow({
    where: { id: credit.orgId },
    select: { billingType: true, wallet: { select: { id: true } } },
  });
  const ref = {
    referenceType: credit.referenceType,
    referenceId: credit.referenceId,
    description: credit.description,
    actorId: credit.actorId ?? null,
  };
  if (org.billingType === 'INTERNAL') {
    await applyLedger(tx, {
      walletId: credit.walletId,
      type: 'BONUS',
      amountMicros: credit.amountMicros,
      ...ref,
    });
    return true;
  }
  if (!org.wallet) return false;
  return transferCredits(tx, {
    fromWalletId: org.wallet.id,
    toWalletId: credit.walletId,
    amountMicros: credit.amountMicros,
    ...ref,
  });
}

/**
 * Creates or updates an end user and makes sure it has a wallet. New users get the project's
 * free credit (once, keyed by the app user id) unless the org pays everything. The credit comes
 * out of the organization's wallet (PIE R-01): without enough balance the user is still created,
 * just without it (`freeCredit: 'insufficient_org_balance'`).
 */
export async function upsertAppUser(prisma: PrismaClient, project: Project, input: AppUserInput) {
  const data = {
    ...(input.email !== undefined ? { email: input.email } : {}),
    ...(input.name !== undefined ? { name: input.name } : {}),
    ...(input.document !== undefined ? { document: onlyDigits(input.document) } : {}),
  };
  try {
    return await prisma.$transaction(async (tx) => {
      const existing = await tx.appUser.findUnique({
        where: { projectId_externalId: { projectId: project.id, externalId: input.externalId } },
      });
      const user = existing
        ? await tx.appUser.update({ where: { id: existing.id }, data })
        : await tx.appUser.create({
            data: { projectId: project.id, externalId: input.externalId, ...data },
          });
      let wallet = await tx.wallet.findUnique({ where: { appUserId: user.id } });
      let created = false;
      let freeCredit: FreeCreditResult = null;
      if (!wallet) {
        wallet = await tx.wallet.create({ data: { ownerType: 'APP_USER', appUserId: user.id } });
        created = true;
        if (project.freeCreditMicros > 0n && project.billingMode !== 'ORG_WALLET') {
          const given = await giveEndUserCredit(tx, {
            orgId: project.orgId,
            walletId: wallet.id,
            amountMicros: project.freeCreditMicros,
            referenceType: 'free_credit',
            referenceId: user.id,
            description: 'Crédito grátis de boas-vindas',
          });
          freeCredit = given ? 'granted' : 'insufficient_org_balance';
          if (given) wallet = await tx.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
        }
      }
      return { user, wallet, created: !existing || created, freeCredit };
    });
  } catch (err) {
    // Two concurrent upserts of the same externalId: the second one just reads.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      const user = await prisma.appUser.findUniqueOrThrow({
        where: { projectId_externalId: { projectId: project.id, externalId: input.externalId } },
      });
      const wallet = await prisma.wallet.findUniqueOrThrow({ where: { appUserId: user.id } });
      return { user, wallet, created: false, freeCredit: null as FreeCreditResult };
    }
    throw err;
  }
}

/** Outcome of the welcome credit for a new end user (null: none was due). */
export type FreeCreditResult = 'granted' | 'insufficient_org_balance' | null;

export function serializeAppUser(
  user: {
    id: string;
    externalId: string;
    email: string | null;
    name: string | null;
    blockedAt?: Date | null;
    createdAt: Date;
  },
  wallet: { balanceMicros: bigint; reservedMicros: bigint } | null,
) {
  const balance = wallet?.balanceMicros ?? 0n;
  const reserved = wallet?.reservedMicros ?? 0n;
  return {
    id: user.id,
    externalId: user.externalId,
    email: user.email,
    name: user.name,
    balanceMicros: balance.toString(),
    availableMicros: (balance - reserved).toString(),
    blockedAt: user.blockedAt?.toISOString() ?? null,
    createdAt: user.createdAt.toISOString(),
  };
}

export function issueSessionToken(
  appUserId: string,
  projectId: string,
  secret: string,
  now = Date.now(),
  apiKeyId?: string,
) {
  const iat = Math.floor(now / 1000);
  const claims: SessionClaims = {
    sub: appUserId,
    pid: projectId,
    scp: [...SESSION_SCOPES],
    iat,
    exp: iat + SESSION_TTL_SECONDS,
    jti: randomUUID(),
    ...(apiKeyId ? { kid: apiKeyId } : {}),
  };
  return {
    token: `${SESSION_TOKEN_PREFIX}${signJwt(claims, secret)}`,
    expiresAt: new Date(claims.exp * 1000),
  };
}

export function verifySessionToken(token: string, secret: string): SessionClaims | null {
  if (!token.startsWith(SESSION_TOKEN_PREFIX)) return null;
  const claims = verifyJwt<SessionClaims>(token.slice(SESSION_TOKEN_PREFIX.length), secret);
  if (
    !claims ||
    typeof claims.sub !== 'string' ||
    typeof claims.pid !== 'string' ||
    !Array.isArray(claims.scp)
  ) {
    return null;
  }
  return claims;
}
