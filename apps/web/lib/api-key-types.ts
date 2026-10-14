export type ApiKeyInfo = {
  id: string;
  projectId: string;
  name: string;
  env: 'LIVE' | 'TEST';
  prefix: string;
  scopes: string[];
  spendLimitMicros: string | null;
  rpmLimit: number | null;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
};

/** Returned only once, right after creation. */
export type CreatedApiKey = ApiKeyInfo & { key: string };
