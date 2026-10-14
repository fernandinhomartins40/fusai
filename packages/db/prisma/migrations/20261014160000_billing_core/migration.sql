-- CreateTable
CREATE TABLE "WalletHold" (
    "id" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "amountMicros" BIGINT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WalletHold_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WalletHold_walletId_idx" ON "WalletHold"("walletId");

-- CreateIndex
CREATE INDEX "WalletHold_expiresAt_idx" ON "WalletHold"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "LedgerEntry_type_referenceType_referenceId_key" ON "LedgerEntry"("type", "referenceType", "referenceId");

-- AddForeignKey
ALTER TABLE "WalletHold" ADD CONSTRAINT "WalletHold_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "Wallet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

