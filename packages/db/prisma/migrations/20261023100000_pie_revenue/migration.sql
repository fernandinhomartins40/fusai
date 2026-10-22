-- PIE R-01: credit an organization gives to its end users is a transfer from the org wallet.
ALTER TYPE "LedgerType" ADD VALUE 'TRANSFER_OUT';
ALTER TYPE "LedgerType" ADD VALUE 'TRANSFER_IN';

-- PIE R-07: end user blocked after refunding or charging back credits already spent.
ALTER TABLE "AppUser" ADD COLUMN "blockedAt" TIMESTAMP(3);

-- PIE R-06: credits already taken back by (partial) refunds.
ALTER TABLE "Payment" ADD COLUMN "refundedMicros" BIGINT NOT NULL DEFAULT 0;
