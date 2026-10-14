import type { PrismaClient } from '@fuseai/db';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { sessionGuards } from '../../lib/session';

type Options = { prisma: PrismaClient; guards: ReturnType<typeof sessionGuards> };

/** Super-admin routes. Every route here requires role SUPER_ADMIN. */
export const adminRoutes: FastifyPluginAsyncZod<Options> = async (app, { prisma, guards }) => {
  app.addHook('preHandler', guards.requireSuperAdmin);

  app.get('/internal/admin/overview', async () => {
    const [users, organizations, providers, activeModels] = await Promise.all([
      prisma.user.count(),
      prisma.organization.count(),
      prisma.provider.count(),
      prisma.model.count({ where: { active: true } }),
    ]);
    return { users, organizations, providers, activeModels };
  });
};
