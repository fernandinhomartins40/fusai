import type { ApiKey, PrismaClient } from '@fuseai/db';
import { apiKeyCreateSchema, apiKeyUpdateSchema } from '@fuseai/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { audit } from '../../lib/audit';
import type { Env } from '../../lib/env';
import { notFound } from '../../lib/errors';
import { currentUser } from '../../lib/session';
import { generateApiKey, hashApiKey, keyDisplayPrefix } from '../api-keys/keys';
import { requireMembership } from './membership';
import { serializeProject } from './projects';

const EDITORS = ['OWNER', 'ADMIN', 'DEVELOPER'] as const;

export function serializeKey(key: ApiKey) {
  return {
    id: key.id,
    projectId: key.projectId,
    name: key.name,
    env: key.env,
    prefix: key.prefix,
    scopes: key.scopes,
    spendLimitMicros: key.spendLimitMicros?.toString() ?? null,
    rpmLimit: key.rpmLimit,
    lastUsedAt: key.lastUsedAt?.toISOString() ?? null,
    expiresAt: key.expiresAt?.toISOString() ?? null,
    revokedAt: key.revokedAt?.toISOString() ?? null,
    createdAt: key.createdAt.toISOString(),
  };
}

/** Project details and API key management for organization members. */
export const dashboardApiKeyRoutes: FastifyPluginAsyncZod<{
  prisma: PrismaClient;
  env: Env;
}> = async (app, { prisma, env }) => {
  async function projectFor(
    userId: string,
    projectId: string,
    roles?: readonly (typeof EDITORS)[number][],
  ) {
    const project = await prisma.project.findUnique({ where: { id: projectId } });
    if (!project) throw notFound('Projeto não encontrado');
    await requireMembership(prisma, userId, project.orgId, roles);
    return project;
  }

  async function keyFor(userId: string, keyId: string) {
    const key = await prisma.apiKey.findUnique({ where: { id: keyId } });
    if (!key) throw notFound('Chave não encontrada');
    await projectFor(userId, key.projectId, EDITORS);
    return key;
  }

  const projectParams = z.object({ projectId: z.string().min(1) });
  const keyParams = z.object({ id: z.string().min(1) });

  app.get('/internal/projects/:projectId', { schema: { params: projectParams } }, async (req) => {
    return serializeProject(await projectFor(currentUser(req).id, req.params.projectId));
  });

  app.get(
    '/internal/projects/:projectId/api-keys',
    { schema: { params: projectParams } },
    async (req) => {
      await projectFor(currentUser(req).id, req.params.projectId);
      const keys = await prisma.apiKey.findMany({
        where: { projectId: req.params.projectId },
        orderBy: [{ revokedAt: { sort: 'desc', nulls: 'first' } }, { createdAt: 'desc' }],
      });
      return { keys: keys.map(serializeKey) };
    },
  );

  app.post(
    '/internal/projects/:projectId/api-keys',
    { schema: { params: projectParams, body: apiKeyCreateSchema } },
    async (req, reply) => {
      const user = currentUser(req);
      const project = await projectFor(user.id, req.params.projectId, EDITORS);
      const plain = generateApiKey(req.body.env);
      const key = await prisma.apiKey.create({
        data: {
          projectId: project.id,
          name: req.body.name,
          env: req.body.env,
          prefix: keyDisplayPrefix(plain),
          hash: hashApiKey(plain, env.KEY_PEPPER),
          scopes: req.body.scopes,
          spendLimitMicros: req.body.spendLimitMicros ? BigInt(req.body.spendLimitMicros) : null,
          rpmLimit: req.body.rpmLimit ?? null,
          expiresAt: req.body.expiresAt ? new Date(req.body.expiresAt) : null,
          createdById: user.id,
        },
      });
      await audit(prisma, req, 'api_key.create', key.id, {
        projectId: project.id,
        env: key.env,
        prefix: key.prefix,
      });
      // The only time the full key is ever returned.
      return reply.status(201).send({ ...serializeKey(key), key: plain });
    },
  );

  app.patch(
    '/internal/api-keys/:id',
    { schema: { params: keyParams, body: apiKeyUpdateSchema } },
    async (req) => {
      const key = await keyFor(currentUser(req).id, req.params.id);
      const { spendLimitMicros, ...rest } = req.body;
      const updated = await prisma.apiKey.update({
        where: { id: key.id },
        data: {
          ...rest,
          ...(spendLimitMicros !== undefined && {
            spendLimitMicros: spendLimitMicros == null ? null : BigInt(spendLimitMicros),
          }),
        },
      });
      await audit(prisma, req, 'api_key.update', key.id, { fields: Object.keys(req.body) });
      return serializeKey(updated);
    },
  );

  app.post('/internal/api-keys/:id/revoke', { schema: { params: keyParams } }, async (req) => {
    const key = await keyFor(currentUser(req).id, req.params.id);
    const updated = key.revokedAt
      ? key
      : await prisma.apiKey.update({ where: { id: key.id }, data: { revokedAt: new Date() } });
    await audit(prisma, req, 'api_key.revoke', key.id, { prefix: key.prefix });
    return serializeKey(updated);
  });
};
