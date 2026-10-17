import type { PrismaClient } from '@fusai/db';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { Env } from '../../lib/env';
import type { JobQueue } from '../../lib/jobs';
import type { RedisClient } from '../../lib/redis';
import type { sessionGuards } from '../../lib/session';
import type { SettingsStore } from '../../lib/settings';
import type { PaymentProvider } from '../../payments/types';
import type { CatalogStore } from '../gateway/catalog';
import { adminPaymentRoutes } from '../payments/routes';
import { adminDashboardRoutes } from './dashboard';
import { adminModelRoutes } from './models';
import { adminOperationsRoutes } from './operations';
import { adminOrganizationRoutes } from './organizations';
import { adminPackageRoutes } from './packages';
import { adminProviderRoutes } from './providers';
import { adminSettingsRoutes } from './settings';
import { adminUsageRoutes } from './usage';
import { adminUserRoutes } from './users';

type Options = {
  prisma: PrismaClient;
  env: Env;
  guards: ReturnType<typeof sessionGuards>;
  settings: SettingsStore;
  encryptionKey: Buffer;
  catalog: CatalogStore;
  provider: PaymentProvider;
  redis: RedisClient;
  jobs: JobQueue;
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
  await app.register(adminDashboardRoutes, opts);
  await app.register(adminUserRoutes, opts);
  await app.register(adminPackageRoutes, opts);
  await app.register(adminUsageRoutes, opts);
  await app.register(adminOperationsRoutes, opts);
};
