import type { PrismaClient } from '@fuseai/db';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { Env } from '../../lib/env';
import type { sessionGuards } from '../../lib/session';
import type { SettingsStore } from '../../lib/settings';
import { adminModelRoutes } from './models';
import { adminProviderRoutes } from './providers';
import { adminSettingsRoutes } from './settings';

type Options = {
  prisma: PrismaClient;
  env: Env;
  guards: ReturnType<typeof sessionGuards>;
  settings: SettingsStore;
  encryptionKey: Buffer;
};

/** Super-admin routes. Every route here requires role SUPER_ADMIN. */
export const adminRoutes: FastifyPluginAsyncZod<Options> = async (app, opts) => {
  const { prisma, guards } = opts;
  app.addHook('onRequest', guards.requireSuperAdmin);

  app.get('/internal/admin/overview', async () => {
    const [users, organizations, providers, activeModels] = await Promise.all([
      prisma.user.count(),
      prisma.organization.count(),
      prisma.provider.count(),
      prisma.model.count({ where: { active: true } }),
    ]);
    return { users, organizations, providers, activeModels };
  });

  await app.register(adminProviderRoutes, opts);
  await app.register(adminModelRoutes, opts);
  await app.register(adminSettingsRoutes, opts);
};
