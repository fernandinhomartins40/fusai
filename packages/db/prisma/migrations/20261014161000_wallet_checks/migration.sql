-- Safety net for the billing invariants (Prisma does not model CHECK constraints).
ALTER TABLE "Wallet" ADD CONSTRAINT "Wallet_reserved_nonnegative" CHECK ("reservedMicros" >= 0);
ALTER TABLE "WalletHold" ADD CONSTRAINT "WalletHold_amount_nonnegative" CHECK ("amountMicros" >= 0);
