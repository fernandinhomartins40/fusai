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
    const parsed = settingsSchema.safeParse(raw);
    return parsed.success ? parsed.data : DEFAULT_SETTINGS;
  }

  return {
    async get(): Promise<Settings> {
      if (cache && cache.expiresAt > Date.now()) return cache.value;
      const value = await load();
      cache = { value, expiresAt: Date.now() + TTL_MS };
      return value;
    },
    async save(values: Settings): Promise<Settings> {
      await prisma.$transaction(
        Object.entries(values).map(([key, value]) =>
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
