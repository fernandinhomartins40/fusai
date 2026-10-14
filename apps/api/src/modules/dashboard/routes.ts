import type { PrismaClient } from '@fuseai/db';
import { createOrganizationSchema, createProjectSchema } from '@fuseai/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Env } from '../../lib/env';
import type { Mailer } from '../../lib/mailer';
import { currentUser, type sessionGuards } from '../../lib/session';
import type { SettingsStore } from '../../lib/settings';
import type { CatalogStore } from '../gateway/catalog';
import { dashboardAnalyticsRoutes } from './analytics';
import { dashboardApiKeyRoutes } from './api-keys';
import { createOrganization, createProject } from './organizations';
import { dashboardProjectRoutes } from './projects';
import { dashboardTeamRoutes } from './team';
import { dashboardWalletRoutes } from './wallet';

type Options = {
  prisma: PrismaClient;
  env: Env;
  guards: ReturnType<typeof sessionGuards>;
  settings: SettingsStore;
  catalog: CatalogStore;
  encryptionKey: Buffer;
  mailer: Mailer;
};

/** Cookie-authenticated routes used by the customer dashboard. */
export const dashboardRoutes: FastifyPluginAsyncZod<Options> = async (
  app,
  { prisma, env, guards, settings, catalog, encryptionKey, mailer },
) => {
  app.addHook('onRequest', guards.requireUser);
  await app.register(dashboardWalletRoutes, { prisma });
  await app.register(dashboardApiKeyRoutes, { prisma, env });
  await app.register(dashboardAnalyticsRoutes, { prisma, settings });
  await app.register(dashboardProjectRoutes, { prisma, env, settings, catalog, encryptionKey });
  await app.register(dashboardTeamRoutes, { prisma, env, mailer });

  app.get('/internal/me', async (req) => {
    const user = currentUser(req);
    const memberships = await prisma.membership.findMany({
      where: { userId: user.id },
      include: {
        org: {
          include: {
            wallet: true,
            projects: {
              orderBy: { createdAt: 'asc' },
              select: { id: true, name: true, slug: true, billingMode: true },
            },
          },
        },
      },
      orderBy: { org: { createdAt: 'asc' } },
    });
    return {
      user,
      organizations: memberships.map(({ role, org }) => ({
        id: org.id,
        name: org.name,
        slug: org.slug,
        role,
        status: org.status,
        billingType: org.billingType,
        balanceMicros: (org.wallet?.balanceMicros ?? 0n).toString(),
        reservedMicros: (org.wallet?.reservedMicros ?? 0n).toString(),
        projects: org.projects,
      })),
    };
  });

  app.post(
    '/internal/onboarding/organization',
    { schema: { body: createOrganizationSchema } },
    async (req, reply) => {
      const user = currentUser(req);
      const org = await createOrganization(prisma, user.id, req.body, settings);
      return reply.status(201).send({ id: org.id, name: org.name, slug: org.slug });
    },
  );

  app.post(
    '/internal/organizations/:orgId/projects',
    { schema: { params: z.object({ orgId: z.string().min(1) }), body: createProjectSchema } },
    async (req, reply) => {
      const user = currentUser(req);
      const project = await createProject(prisma, user.id, req.params.orgId, req.body);
      return reply.status(201).send({
        id: project.id,
        name: project.name,
        slug: project.slug,
        billingMode: project.billingMode,
      });
    },
  );
};
