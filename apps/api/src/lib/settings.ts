import type { PrismaClient } from '@fusai/db';
import { DEFAULT_SETTINGS, type Settings, settingsSchema } from '@fusai/shared';

const TTL_MS = 60_000;

/**
 * Global settings (exchange rate, markup, top-up rules) cached in memory for 60s.
 * Admin writes call `invalidate()` so new prices apply immediately on this instance.
 */
export function createSettingsStore(prisma: PrismaClient) {
  let cache: { value: Settings; expiresAt: number } | null = null;

  async function load(): Promise<Settings> {
    const rows = await prisma.setting.findMany();
    const raw: Record<string, unknown> = { ...DEFAULT_SETTINGS };
    for (const row of rows) {
      if (row.key in DEFAULT_SETTINGS) raw[row.key] = String(row.value);
    }
    const parsed = safeParse(raw);
    if (parsed) return parsed;
    // Only the invalid keys fall back to their defaults (PIE D-07): one bad row must not
    // reset (or break) the exchange rate, markup and fees.
    const defaults = DEFAULT_SETTINGS as Record<string, unknown>;
    const shape = settingsSchema.shape as Record<string, { safeParse: (v: unknown) => unknown }>;
    const bad = Object.entries(shape)
      .filter(([key, schema]) => !validField(schema, raw[key]))
      .map(([key]) => key);
    console.error(`settings: invalid values for ${bad.join(', ')}; using their defaults`);
    for (const key of bad) raw[key] = defaults[key];
    return safeParse(raw) ?? DEFAULT_SETTINGS;
  }

  /** Some refinements throw on garbage instead of failing; treat that as invalid too. */
  function safeParse(raw: Record<string, unknown>): Settings | null {
    try {
      const r = settingsSchema.safeParse(raw);
      return r.success ? r.data : null;
    } catch {
      return null;
    }
  }
  function validField(schema: { safeParse: (v: unknown) => unknown }, value: unknown) {
    try {
      return (schema.safeParse(value) as { success: boolean }).success;
    } catch {
      return false;
    }
  }

  return {
    async get(): Promise<Settings> {
      if (cache && cache.expiresAt > Date.now()) return cache.value;
      const value = await load();
      cache = { value, expiresAt: Date.now() + TTL_MS };
      return value;
    },
    async save(values: Settings): Promise<Settings> {
      // Only changed keys are written, so `updatedAt` tells when each value really changed
      // (the admin readiness check uses it for the exchange rate age).
      const current = new Map(
        (await prisma.setting.findMany()).map((row) => [row.key, String(row.value)]),
      );
      const changed = Object.entries(values).filter(
        ([key, value]) => current.get(key) !== String(value),
      );
      await prisma.$transaction(
        changed.map(([key, value]) =>
          prisma.setting.upsert({
            where: { key },
            update: { value: String(value) },
            create: { key, value: String(value) },
          }),
        ),
      );
      cache = null;
      return this.get();
    },
    invalidate() {
      cache = null;
    },
  };
}

export type SettingsStore = ReturnType<typeof createSettingsStore>;
