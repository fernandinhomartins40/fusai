-- Better Auth admin plugin: ban users and impersonation ("entrar como cliente").
ALTER TABLE "user" ADD COLUMN "banned" BOOLEAN DEFAULT false,
ADD COLUMN "banReason" TEXT,
ADD COLUMN "banExpires" TIMESTAMP(3);

ALTER TABLE "session" ADD COLUMN "impersonatedBy" TEXT;

-- Admin explorers: audit log by action and webhook events by state.
CREATE INDEX "AuditLog_action_createdAt_idx" ON "AuditLog"("action", "createdAt");
CREATE INDEX "InboundWebhookEvent_createdAt_idx" ON "InboundWebhookEvent"("createdAt");
