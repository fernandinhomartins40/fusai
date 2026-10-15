import type { PrismaClient } from '@fusai/db';
import { settingsSchema } from '@fusai/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { audit } from '../../lib/audit';
import type { SettingsStore } from '../../lib/settings';

type Options = { prisma: PrismaClient; settings: SettingsStore };

export const adminSettingsRoutes: FastifyPluginAsyncZod<Options> = async (
  app,
  { prisma, settings },
) => {
  app.get('/internal/admin/settings', async () => settings.get());

  app.put('/internal/admin/settings', { schema: { body: settingsSchema } }, async (req) => {
    const before = await settings.get();
    const after = await settings.save(req.body);
    const changed = Object.fromEntries(
      Object.entries(after)
        .filter(([key, value]) => before[key as keyof typeof before] !== value)
        .map(([key, value]) => [key, { from: before[key as keyof typeof before], to: value }]),
    );
    await audit(prisma, req, 'settings.update', null, changed);
    return after;
  });
};
