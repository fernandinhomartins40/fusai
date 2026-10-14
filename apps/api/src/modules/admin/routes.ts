import type { PrismaClient } from '@fuseai/db';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { Env } from '../../lib/env';
import type { sessionGuards } from '../../lib/session';
import type { SettingsStore } from '../../lib/settings';
import type { PaymentProvider } from '../../payments/types';
import type { CatalogStore } from '../gateway/catalog';
import { adminPaymentRoutes } from '../payments/routes';
import { adminModelRoutes } from './models';
import { adminOrganizationRoutes } from './organizations';
import { adminProviderRoutes } from './providers';
import { adminSettingsRoutes } from './settings';

type Options = {
  prisma: PrismaClient;
  env: Env;
  guards: ReturnType<typeof sessionGuards>;
  settings: SettingsStore;
  encryptionKey: Buffer;
  catalog: CatalogStore;
  provider: PaymentProvider;
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
  await app.register(adminOrganizationRoutes, opts);
  await app.register(adminPaymentRoutes, opts);
};
