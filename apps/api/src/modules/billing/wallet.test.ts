import { prisma } from '@fuseai/db';
import { beforeEach, describe, expect, it } from 'vitest';
import { createFundedOrg, resetDb } from '../../../test/helpers';
import { ledgerSum, releaseExpiredHolds, reserve, settle } from './wallet';

const wallet = (id: string) => prisma.wallet.findUniqueOrThrow({ where: { id } });

/** Deterministic pseudo-random generator (mulberry32) so failures are reproducible. */
function rng(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Samples the wallet while `work` runs and records the lowest available balance seen. */
async function watchAvailable(walletId: string, work: Promise<unknown>) {
  let done = false;
  let lowest: bigint | null = null;
  const poll = (async () => {
    while (!done) {
      const w = await wallet(walletId);
      const available = w.balanceMicros - w.reservedMicros;
      if (lowest === null || available < lowest) lowest = available;
    }
  })();
  await work;
  done = true;
  await poll;
  return lowest ?? 0n;
}

describe('billing: reserve -> settle', () => {
  beforeEach(resetDb);

  it('50 concurrent reserves never overdraw a PREPAID wallet', async () => {
    const { walletId } = await createFundedOrg({ balanceMicros: 1_000_000n }); // R$ 1,00
    const hold = 30_000n; // R$ 0,03 -> at most 33 fit

    const attempts = Array.from({ length: 50 }, (_, i) =>
      reserve(prisma, { walletId, requestId: `req-${i}`, amountMicros: hold }),
    );
    const all = Promise.all(attempts);
    const lowest = await watchAvailable(walletId, all);
    const results = await all;

    const ok = results.filter(Boolean).length;
    expect(ok).toBe(33);
    expect(lowest).toBeGreaterThanOrEqual(0n);
    const w = await wallet(walletId);
    expect(w.reservedMicros).toBe(hold * 33n);
    expect(w.balanceMicros - w.reservedMicros).toBe(10_000n);
    expect(await prisma.walletHold.count({ where: { walletId } })).toBe(33);
  });

  it('mixed concurrent reserve + settle keeps ledger == balance and frees all holds', async () => {
    const initial = 5_000_000n; // R$ 5,00
    const { walletId } = await createFundedOrg({ balanceMicros: initial });
    const random = rng(42);

    const plans = Array.from({ length: 50 }, (_, i) => {
      const holdMicros = BigInt(50_000 + Math.floor(random() * 250_000));
      // ~20% fail without tokens (charge 0); others cost up to the hold.
      const charge = random() < 0.2 ? 0n : (holdMicros * BigInt(Math.floor(random() * 101))) / 100n;
      return { requestId: `mix-${i}`, holdMicros, charge };
    });

    const run = Promise.all(
      plans.map(async (p) => {
        const ok = await reserve(prisma, {
          walletId,
          requestId: p.requestId,
          amountMicros: p.holdMicros,
        });
        if (!ok) return 0n;
        const res = await settle(prisma, {
          requestId: p.requestId,
          walletId,
          chargeMicros: p.charge,
        });
        return res.charged;
      }),
    );
    const lowest = await watchAvailable(walletId, run);
    const charges = await run;
    const charged = charges.reduce((a, b) => a + b, 0n);

    const w = await wallet(walletId);
    expect(lowest).toBeGreaterThanOrEqual(0n);
    expect(w.reservedMicros).toBe(0n);
    expect(await prisma.walletHold.count()).toBe(0);
    expect(w.balanceMicros).toBe(initial - charged);
    expect(w.balanceMicros).toBeGreaterThanOrEqual(0n);
    expect(await ledgerSum(prisma, walletId)).toBe(w.balanceMicros);

    // One USAGE entry per charged request, and balanceAfter values chain correctly.
    const entries = await prisma.ledgerEntry.findMany({
      where: { walletId },
      orderBy: { balanceAfter: 'desc' },
    });
    expect(entries.filter((e) => e.type === 'USAGE')).toHaveLength(
      charges.filter((c) => c > 0n).length,
    );
    const balances = new Set(entries.map((e) => e.balanceAfter));
    expect(balances.size).toBe(entries.length); // each debit saw a distinct, serialized balance
    expect(balances.has(w.balanceMicros)).toBe(true);
  });

  it('POSTPAID wallets may go negative only down to the credit limit', async () => {
    const { walletId } = await createFundedOrg({
      billingType: 'POSTPAID',
      creditLimitMicros: 500_000n,
    });
    const results = await Promise.all(
      Array.from({ length: 50 }, (_, i) =>
        reserve(prisma, {
          walletId,
          requestId: `pp-${i}`,
          amountMicros: 30_000n,
          creditLimitMicros: 500_000n,
        }),
      ),
    );
    expect(results.filter(Boolean).length).toBe(16);
    const w = await wallet(walletId);
    expect(w.balanceMicros - w.reservedMicros).toBe(-480_000n);
  });

  it('blocks even zero-cost requests while the balance is negative', async () => {
    const { walletId } = await createFundedOrg({ balanceMicros: 0n });
    await prisma.wallet.update({ where: { id: walletId }, data: { balanceMicros: -1n } });
    expect(await reserve(prisma, { walletId, requestId: 'z', amountMicros: 0n })).toBe(false);
  });

  it('settles each request once, even when settled concurrently', async () => {
    const { walletId } = await createFundedOrg({ balanceMicros: 1_000_000n });
    await reserve(prisma, { walletId, requestId: 'dup', amountMicros: 100_000n });

    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        settle(prisma, { requestId: 'dup', walletId, chargeMicros: 70_000n }),
      ),
    );
    expect(results.filter((r) => !r.duplicate)).toHaveLength(1);
    const again = await settle(prisma, { requestId: 'dup', walletId, chargeMicros: 70_000n });
    expect(again.duplicate).toBe(true);

    const w = await wallet(walletId);
    expect(w.balanceMicros).toBe(930_000n);
    expect(w.reservedMicros).toBe(0n);
    expect(await ledgerSum(prisma, walletId)).toBe(930_000n);
  });

  it('releases expired holds and still charges a late settlement once', async () => {
    const { walletId } = await createFundedOrg({ balanceMicros: 1_000_000n });
    await reserve(prisma, { walletId, requestId: 'late', amountMicros: 200_000n, ttlMs: -1_000 });
    await reserve(prisma, { walletId, requestId: 'alive', amountMicros: 100_000n });

    expect(await releaseExpiredHolds(prisma)).toBe(1);
    expect((await wallet(walletId)).reservedMicros).toBe(100_000n);

    // The orphaned request finishes after cleanup: charged, reserved untouched.
    const late = await settle(prisma, { requestId: 'late', walletId, chargeMicros: 50_000n });
    expect(late).toMatchObject({ charged: 50_000n, released: 0n, duplicate: false });
    const w = await wallet(walletId);
    expect(w).toMatchObject({ balanceMicros: 950_000n, reservedMicros: 100_000n });
    expect(await releaseExpiredHolds(prisma)).toBe(0);
  });

  it('rejects negative amounts', async () => {
    const { walletId } = await createFundedOrg({ balanceMicros: 1n });
    await expect(
      reserve(prisma, { walletId, requestId: 'n', amountMicros: -1n }),
    ).rejects.toThrow();
    await expect(settle(prisma, { requestId: 'n', walletId, chargeMicros: -1n })).rejects.toThrow();
  });
});
