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

/** Under load the 2 s default wait for a pool connection turned reserves and charges into 500s. */
const BUSY_TX = { maxWait: 10_000 };

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

export type TransferInput = {
  fromWalletId: string;
  toWalletId: string;
  amountMicros: bigint;
  referenceType: string;
  referenceId: string;
  description?: string | null;
  actorId?: string | null;
};

/**
 * Moves credits from an organization wallet to one of its end users (PIE R-01): the org pays
 * for every credit it gives away. The debit is conditional, like a reservation: it only happens
 * when the org has that much available (prepaid, never negative). Returns false otherwise.
 * Must run inside a transaction.
 */
export async function transferCredits(tx: Tx, input: TransferInput): Promise<boolean> {
  if (input.amountMicros <= 0n) throw new Error('Transfer must be positive');
  const rows = await tx.$queryRaw<{ balanceMicros: bigint }[]>`
    UPDATE "Wallet"
       SET "balanceMicros" = "balanceMicros" - ${input.amountMicros}, "updatedAt" = ${NOW_UTC}
     WHERE id = ${input.fromWalletId}
       AND "balanceMicros" - "reservedMicros" >= ${input.amountMicros}
    RETURNING "balanceMicros"`;
  const row = rows[0];
  if (!row) return false;
  const common = {
    referenceType: input.referenceType,
    referenceId: input.referenceId,
    description: input.description ?? null,
    actorId: input.actorId ?? null,
  };
  await tx.ledgerEntry.create({
    data: {
      walletId: input.fromWalletId,
      type: 'TRANSFER_OUT',
      amountMicros: -input.amountMicros,
      balanceAfter: row.balanceMicros,
      ...common,
    },
  });
  await applyLedger(tx, {
    walletId: input.toWalletId,
    type: 'TRANSFER_IN',
    amountMicros: input.amountMicros,
    ...common,
  });
  return true;
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
  /**
   * Monthly spend limit of the calling key (PIE R-04/R-05): checked and reserved atomically,
   * counting what was already charged this month plus every hold still in flight.
   */
  spendLimit?: { apiKeyId: string; limitMicros: bigint | null; since: Date };
};

/** The key's monthly spend limit would be exceeded by this hold (-> 402 spend_limit_reached). */
export class SpendLimitReached extends Error {
  constructor(readonly spentMicros: bigint) {
    super('Spend limit reached');
  }
}

/** Charged this month plus in-flight holds of a key, read in one snapshot. */
async function keySpendInFlight(tx: Tx, apiKeyId: string, since: Date): Promise<bigint> {
  const [row] = await tx.$queryRaw<{ used: bigint }[]>`
    SELECT (SELECT COALESCE(SUM("chargedMicros"), 0) FROM "UsageLog"
             WHERE "apiKeyId" = ${apiKeyId} AND "createdAt" >= ${since})
         + (SELECT COALESCE(SUM("amountMicros"), 0) FROM "WalletHold"
             WHERE "apiKeyId" = ${apiKeyId}) AS used`;
  return BigInt(row?.used ?? 0);
}

/**
 * Atomically reserves `amountMicros`. Returns false when the available balance
 * (balance - reserved + creditLimit) is lower than the hold (-> 402 insufficient_funds).
 * A zero hold still requires a non-negative available balance (blocks wallets left negative
 * by a refund until they are topped up).
 * Throws `SpendLimitReached` when `spendLimit` is set and the hold does not fit in it.
 */
export async function reserve(prisma: PrismaClient, input: ReserveInput): Promise<boolean> {
  if (input.amountMicros < 0n) throw new Error('Hold cannot be negative');
  const limit = input.creditLimitMicros ?? 0n;
  const expiresAt = new Date(Date.now() + (input.ttlMs ?? HOLD_TTL_MS));
  const spend = input.spendLimit;
  return prisma.$transaction(async (tx) => {
    if (spend) {
      // One reservation at a time per key, so concurrent requests cannot all pass the check.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`spend:${spend.apiKeyId}`}))`;
      if (spend.limitMicros != null) {
        const used = await keySpendInFlight(tx, spend.apiKeyId, spend.since);
        if (used + input.amountMicros > spend.limitMicros) throw new SpendLimitReached(used);
      }
    }
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
        apiKeyId: spend?.apiKeyId ?? null,
        expiresAt,
      },
    });
    return true;
  }, BUSY_TX);
}

export type SettleInput = {
  requestId: string;
  walletId: string;
  /** Real cost to charge (0 = release only, e.g. upstream failed before any token). */
  chargeMicros: bigint;
  description?: string;
  /**
   * Post-paid credit of this wallet (0 = prepaid). The charge never takes the wallet below
   * -creditLimit: a prepaid customer never owes (D-128). Anything above is absorbed by fusai.
   */
  creditLimitMicros?: bigint;
  /** Runs inside the settlement transaction with the amount really charged. */
  onSettled?: (tx: Tx, charged: bigint) => Promise<unknown>;
};

export type SettleResult = {
  charged: bigint;
  released: bigint;
  duplicate: boolean;
  /** Part of the real cost that was NOT charged because the balance ran out. */
  absorbed: bigint;
};

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
        if (already) return { charged: 0n, released: 0n, duplicate: true, absorbed: 0n };
      }

      const released = hold?.amountMicros ?? 0n;
      if (released > 0n) {
        await tx.$executeRaw`
          UPDATE "Wallet"
             SET "reservedMicros" = "reservedMicros" - ${released}, "updatedAt" = ${NOW_UTC}
           WHERE id = ${input.walletId}`;
      }
      // Never below -creditLimit (prepaid: never below zero). Other requests' holds stay intact.
      let charge = input.chargeMicros;
      if (charge > 0n) {
        const [w] = await tx.$queryRaw<{ balanceMicros: bigint; reservedMicros: bigint }[]>`
          SELECT "balanceMicros", "reservedMicros" FROM "Wallet" WHERE id = ${input.walletId} FOR UPDATE`;
        const room =
          (w?.balanceMicros ?? 0n) - (w?.reservedMicros ?? 0n) + (input.creditLimitMicros ?? 0n);
        if (charge > room) charge = room > 0n ? room : 0n;
      }
      if (charge > 0n) {
        await applyLedger(tx, {
          walletId: input.walletId,
          type: 'USAGE',
          amountMicros: -charge,
          referenceType: 'usage',
          referenceId: input.requestId,
          description: input.description ?? null,
        });
      }
      await input.onSettled?.(tx, charge);
      return {
        charged: charge,
        released,
        duplicate: false,
        absorbed: input.chargeMicros - charge,
      };
    }, BUSY_TX);
  } catch (err) {
    // A concurrent settle of the same request won the race: the unique ledger key rejected us.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return { charged: 0n, released: 0n, duplicate: true, absorbed: 0n };
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
