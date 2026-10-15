/**
 * Wallets and the immutable ledger (PRD §7.4).
 *
 * Invariants:
 * - Every balance change goes through `applyLedger`, which updates the wallet with
 *   `UPDATE ... RETURNING` (row lock) and records the resulting `balanceAfter`.
 *   So the ledger always sums to the balance, even under concurrency.
 * - Reservations use one conditional UPDATE: `balance - reserved + creditLimit >= hold`.
 *   A PREPAID wallet (limit 0) can never have `balance - reserved < 0` from holds.
 * - LedgerEntry has UNIQUE(type, referenceType, referenceId): a request is charged at most once.
 */
import { type LedgerType, Prisma, type PrismaClient } from '@fusai/db';
import { notFound } from '../../lib/errors';

export type Tx = Prisma.TransactionClient;

/** Holds live longer than the slowest upstream call (10 min) before cleanup releases them. */
export const HOLD_TTL_MS = 15 * 60 * 1000;

/**
 * Prisma stores DateTime as UTC in `timestamp` (no time zone) columns. Raw SQL must use UTC
 * explicitly: a bare `now()` or a timestamptz parameter is converted with the session time zone.
 */
const NOW_UTC = Prisma.sql`(now() AT TIME ZONE 'UTC')`;

export type LedgerInput = {
  walletId: string;
  type: LedgerType;
  amountMicros: bigint; // positive = credit, negative = debit
  referenceType?: string | null;
  referenceId?: string | null;
  description?: string | null;
  actorId?: string | null;
};

/** Applies a signed amount to the balance and records it. Must run inside a transaction. */
export async function applyLedger(tx: Tx, entry: LedgerInput) {
  const rows = await tx.$queryRaw<{ balanceMicros: bigint }[]>`
    UPDATE "Wallet"
       SET "balanceMicros" = "balanceMicros" + ${entry.amountMicros}, "updatedAt" = ${NOW_UTC}
     WHERE id = ${entry.walletId}
    RETURNING "balanceMicros"`;
  const row = rows[0];
  if (!row) throw notFound('Carteira não encontrada');
  return tx.ledgerEntry.create({
    data: {
      walletId: entry.walletId,
      type: entry.type,
      amountMicros: entry.amountMicros,
      balanceAfter: row.balanceMicros,
      referenceType: entry.referenceType ?? null,
      referenceId: entry.referenceId ?? null,
      description: entry.description ?? null,
      actorId: entry.actorId ?? null,
    },
  });
}

/** Credit or debit in its own transaction. */
export function postLedger(prisma: PrismaClient, entry: LedgerInput) {
  return prisma.$transaction((tx) => applyLedger(tx, entry));
}

export type ReserveInput = {
  walletId: string;
  requestId: string;
  amountMicros: bigint;
  /** POSTPAID credit limit; 0 for PREPAID. */
  creditLimitMicros?: bigint;
  ttlMs?: number;
};

/**
 * Atomically reserves `amountMicros`. Returns false when the available balance
 * (balance - reserved + creditLimit) is lower than the hold (-> 402 insufficient_funds).
 * A zero hold still requires a non-negative available balance (blocks wallets left negative
 * by a refund until they are topped up).
 */
export async function reserve(prisma: PrismaClient, input: ReserveInput): Promise<boolean> {
  if (input.amountMicros < 0n) throw new Error('Hold cannot be negative');
  const limit = input.creditLimitMicros ?? 0n;
  const expiresAt = new Date(Date.now() + (input.ttlMs ?? HOLD_TTL_MS));
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ id: string }[]>`
      UPDATE "Wallet"
         SET "reservedMicros" = "reservedMicros" + ${input.amountMicros}, "updatedAt" = ${NOW_UTC}
       WHERE id = ${input.walletId}
         AND "balanceMicros" - "reservedMicros" + ${limit} >= ${input.amountMicros}
      RETURNING id`;
    if (rows.length === 0) return false;
    await tx.walletHold.create({
      data: {
        id: input.requestId,
        walletId: input.walletId,
        amountMicros: input.amountMicros,
        expiresAt,
      },
    });
    return true;
  });
}

export type SettleInput = {
  requestId: string;
  walletId: string;
  /** Real cost to charge (0 = release only, e.g. upstream failed before any token). */
  chargeMicros: bigint;
  description?: string;
  /** Runs inside the settlement transaction (e.g. insert the UsageLog atomically). */
  onSettled?: (tx: Tx) => Promise<unknown>;
};

export type SettleResult = { charged: bigint; released: bigint; duplicate: boolean };

/**
 * Settles a request: releases its hold and charges the real cost (PRD §7.4 step 4).
 * Idempotent per requestId. If the hold already expired (released by cleanup),
 * the cost is still charged without touching `reserved`.
 */
export async function settle(prisma: PrismaClient, input: SettleInput): Promise<SettleResult> {
  if (input.chargeMicros < 0n) throw new Error('Charge cannot be negative');
  try {
    return await prisma.$transaction(async (tx) => {
      const holds = await tx.$queryRaw<{ walletId: string; amountMicros: bigint }[]>`
        DELETE FROM "WalletHold" WHERE id = ${input.requestId}
        RETURNING "walletId", "amountMicros"`;
      const hold = holds[0];
      if (hold && hold.walletId !== input.walletId)
        throw new Error('Hold belongs to another wallet');

      if (!hold && input.chargeMicros > 0n) {
        const already = await tx.ledgerEntry.findFirst({
          where: { type: 'USAGE', referenceType: 'usage', referenceId: input.requestId },
          select: { id: true },
        });
        if (already) return { charged: 0n, released: 0n, duplicate: true };
      }

      const released = hold?.amountMicros ?? 0n;
      if (released > 0n) {
        await tx.$executeRaw`
          UPDATE "Wallet"
             SET "reservedMicros" = "reservedMicros" - ${released}, "updatedAt" = ${NOW_UTC}
           WHERE id = ${input.walletId}`;
      }
      if (input.chargeMicros > 0n) {
        await applyLedger(tx, {
          walletId: input.walletId,
          type: 'USAGE',
          amountMicros: -input.chargeMicros,
          referenceType: 'usage',
          referenceId: input.requestId,
          description: input.description ?? null,
        });
      }
      await input.onSettled?.(tx);
      return { charged: input.chargeMicros, released, duplicate: false };
    });
  } catch (err) {
    // A concurrent settle of the same request won the race: the unique ledger key rejected us.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return { charged: 0n, released: 0n, duplicate: true };
    }
    throw err;
  }
}

/** Releases a hold without charging (request failed before producing tokens). */
export function release(prisma: PrismaClient, requestId: string, walletId: string) {
  return settle(prisma, { requestId, walletId, chargeMicros: 0n });
}

/** Releases holds whose request died (expired). Returns how many holds were released. */
export async function releaseExpiredHolds(prisma: PrismaClient, now = new Date()): Promise<number> {
  const rows = await prisma.$queryRaw<{ n: bigint }[]>`
    WITH expired AS (
      DELETE FROM "WalletHold" WHERE "expiresAt" < (${now}::timestamptz AT TIME ZONE 'UTC')
      RETURNING "walletId", "amountMicros"
    ), sums AS (
      SELECT "walletId", SUM("amountMicros")::bigint AS total, COUNT(*)::bigint AS n
        FROM expired GROUP BY "walletId"
    )
    UPDATE "Wallet" w
       SET "reservedMicros" = w."reservedMicros" - s.total, "updatedAt" = ${NOW_UTC}
      FROM sums s
     WHERE w.id = s."walletId"
    RETURNING s.n`;
  return rows.reduce((acc, r) => acc + Number(r.n), 0);
}

/** Credit limit that applies to an organization wallet (only POSTPAID may go negative). */
export function creditLimitFor(org: { billingType: string; creditLimitMicros: bigint }): bigint {
  return org.billingType === 'POSTPAID' ? org.creditLimitMicros : 0n;
}

/** Wallet numbers for API responses (micros as strings). */
export function walletSummary(wallet: {
  id: string;
  balanceMicros: bigint;
  reservedMicros: bigint;
}) {
  return {
    id: wallet.id,
    balanceMicros: wallet.balanceMicros.toString(),
    reservedMicros: wallet.reservedMicros.toString(),
    availableMicros: (wallet.balanceMicros - wallet.reservedMicros).toString(),
  };
}

export async function ledgerSum(prisma: PrismaClient | Tx, walletId: string): Promise<bigint> {
  const agg = await prisma.ledgerEntry.aggregate({
    where: { walletId },
    _sum: { amountMicros: true },
  });
  return agg._sum.amountMicros ?? 0n;
}

/** Cursor-paginated statement, newest first. */
export async function listLedger(
  prisma: PrismaClient,
  walletId: string,
  opts: { cursor?: string; limit?: number } = {},
) {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const rows = await prisma.ledgerEntry.findMany({
    where: { walletId },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
    ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
  });
  const page = rows.slice(0, limit);
  return {
    items: page.map((e) => ({
      id: e.id,
      type: e.type,
      amountMicros: e.amountMicros.toString(),
      balanceAfter: e.balanceAfter.toString(),
      referenceType: e.referenceType,
      referenceId: e.referenceId,
      description: e.description,
      createdAt: e.createdAt.toISOString(),
    })),
    nextCursor: rows.length > limit ? (page.at(-1)?.id ?? null) : null,
  };
}
