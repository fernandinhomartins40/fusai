-- PIE S-09 (LGPD): account deletion with a grace period. Additive only.
ALTER TABLE "user" ADD COLUMN "deletionRequestedAt" TIMESTAMP(3);
ALTER TABLE "user" ADD COLUMN "deletedAt" TIMESTAMP(3);

CREATE INDEX "user_deletionRequestedAt_idx" ON "user"("deletionRequestedAt");
