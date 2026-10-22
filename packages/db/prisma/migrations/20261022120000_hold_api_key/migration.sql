-- In-flight holds count against the key's monthly spend limit (PIE R-05). Additive and nullable.
ALTER TABLE "WalletHold" ADD COLUMN "apiKeyId" TEXT;

CREATE INDEX "WalletHold_apiKeyId_idx" ON "WalletHold"("apiKeyId");
