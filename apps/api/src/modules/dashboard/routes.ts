import type { PrismaClient } from '@fuseai/db';
import { createOrganizationSchema, createProjectSchema } from '@fuseai/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { currentUser, type sessionGuards } from '../../lib/session';
import { createOrganization, createProject } from './organizations';

type Options = { prisma: PrismaClient; guards: ReturnType<typeof sessionGuards> };

/** Cookie-authenticated routes used by the customer dashboard. */
export const dashboardRoutes: FastifyPluginAsyncZod<Options> = async (app, { prisma, guards }) => {
  app.addHook('preHandler', guards.requireUser);

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
      const org = await createOrganization(prisma, user.id, req.body);
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
