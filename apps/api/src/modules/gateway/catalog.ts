import type { Model, PrismaClient, Provider } from '@fuseai/db';
import { decryptSecret } from '../../lib/crypto';

export type CatalogEntry = { model: Model; provider: Provider; apiKey: string | null };
export type Catalog = { bySlug: Map<string, CatalogEntry>; byId: Map<string, CatalogEntry> };

const TTL_MS = 10_000;

/**
 * Models + providers (with decrypted keys) cached in memory for 10s, so the hot path does not
 * hit the database. Admin writes call `invalidate()`; other instances converge within 10s.
 */
export function createCatalog(prisma: PrismaClient, encryptionKey: Buffer) {
  let cache: { value: Catalog; expiresAt: number } | null = null;
  let loading: Promise<Catalog> | null = null;

  async function load(): Promise<Catalog> {
    const models = await prisma.model.findMany({ include: { provider: true } });
    const bySlug = new Map<string, CatalogEntry>();
    const byId = new Map<string, CatalogEntry>();
    for (const { provider, ...model } of models) {
      let apiKey: string | null = null;
      try {
        apiKey = provider.apiKeyEnc ? decryptSecret(provider.apiKeyEnc, encryptionKey) : null;
      } catch {
        apiKey = null; // undecryptable key = provider unusable until the admin re-saves it
      }
      const entry = { model, provider, apiKey };
      bySlug.set(model.slug, entry);
      byId.set(model.id, entry);
    }
    return { bySlug, byId };
  }

  return {
    async get(): Promise<Catalog> {
      if (cache && cache.expiresAt > Date.now()) return cache.value;
      loading ??= load().finally(() => {
        loading = null;
      });
      const value = await loading;
      cache = { value, expiresAt: Date.now() + TTL_MS };
      return value;
    },
    invalidate() {
      cache = null;
    },
  };
}

export type CatalogStore = ReturnType<typeof createCatalog>;

/** A model can serve traffic when it and its provider are active and a key is configured. */
export function isServable(entry: CatalogEntry | undefined): entry is CatalogEntry {
  return !!entry && entry.model.active && entry.provider.status === 'ACTIVE' && !!entry.apiKey;
}
