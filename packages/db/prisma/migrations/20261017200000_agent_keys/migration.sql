-- Organization-wide AI agent keys for the MCP (D-123).
CREATE TABLE "AgentKey" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentKey_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AgentKey_hash_key" ON "AgentKey"("hash");
CREATE INDEX "AgentKey_orgId_idx" ON "AgentKey"("orgId");

ALTER TABLE "AgentKey" ADD CONSTRAINT "AgentKey_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
