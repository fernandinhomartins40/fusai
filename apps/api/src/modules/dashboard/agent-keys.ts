import type { AgentKey, PrismaClient } from '@fusai/db';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { audit } from '../../lib/audit';
import type { Env } from '../../lib/env';
import { HttpError, notFound } from '../../lib/errors';
import { currentUser } from '../../lib/session';
import { agentKeyDisplayPrefix, generateAgentKey, hashApiKey } from '../api-keys/keys';
import { requireMembership } from './membership';

/** Agent keys act for the whole organization: only owners and admins manage them. */
const MANAGERS = ['OWNER', 'ADMIN'] as const;
const MAX_ACTIVE_KEYS = 10;

export function serializeAgentKey(k: AgentKey) {
  return {
    id: k.id,
    name: k.name,
    prefix: k.prefix,
    lastUsedAt: k.lastUsedAt?.toISOString() ?? null,
    revokedAt: k.revokedAt?.toISOString() ?? null,
    createdAt: k.createdAt.toISOString(),
  };
}

const orgParams = z.object({ orgId: z.string().min(1) });
const keyParams = z.object({ orgId: z.string().min(1), id: z.string().min(1) });
const createBody = z.object({ name: z.string().trim().min(2, 'Nome muito curto').max(60) });

/** "Agente de IA" page: organization-wide MCP keys (`fai_agent_`). */
export const dashboardAgentKeyRoutes: FastifyPluginAsyncZod<{
  prisma: PrismaClient;
  env: Env;
}> = async (app, { prisma, env }) => {
  app.get(
    '/internal/organizations/:orgId/agent-keys',
    { schema: { params: orgParams } },
    async (req) => {
      await requireMembership(prisma, currentUser(req).id, req.params.orgId, MANAGERS);
      const keys = await prisma.agentKey.findMany({
        where: { orgId: req.params.orgId },
        orderBy: [{ revokedAt: { sort: 'desc', nulls: 'first' } }, { createdAt: 'desc' }],
      });
      return { keys: keys.map(serializeAgentKey) };
    },
  );

  app.post(
    '/internal/organizations/:orgId/agent-keys',
    { schema: { params: orgParams, body: createBody } },
    async (req, reply) => {
      const user = currentUser(req);
      await requireMembership(prisma, user.id, req.params.orgId, MANAGERS);
      const active = await prisma.agentKey.count({
        where: { orgId: req.params.orgId, revokedAt: null },
      });
      if (active >= MAX_ACTIVE_KEYS) {
        throw new HttpError(
          409,
          'too_many_keys',
          `Máximo de ${MAX_ACTIVE_KEYS} chaves de agente ativas. Revogue uma antes.`,
        );
      }
      const plain = generateAgentKey();
      const key = await prisma.agentKey.create({
        data: {
          orgId: req.params.orgId,
          name: req.body.name,
          prefix: agentKeyDisplayPrefix(plain),
          hash: hashApiKey(plain, env.KEY_PEPPER),
          createdById: user.id,
        },
      });
      await audit(prisma, req, 'agent_key.create', key.id, {
        orgId: req.params.orgId,
        prefix: key.prefix,
      });
      // The only time the full key is ever returned.
      return reply.status(201).send({ ...serializeAgentKey(key), key: plain });
    },
  );

  app.post(
    '/internal/organizations/:orgId/agent-keys/:id/revoke',
    { schema: { params: keyParams } },
    async (req) => {
      await requireMembership(prisma, currentUser(req).id, req.params.orgId, MANAGERS);
      const key = await prisma.agentKey.findFirst({
        where: { id: req.params.id, orgId: req.params.orgId },
      });
      if (!key) throw notFound('Chave não encontrada');
      if (!key.revokedAt) {
        await prisma.agentKey.update({ where: { id: key.id }, data: { revokedAt: new Date() } });
        await audit(prisma, req, 'agent_key.revoke', key.id, {
          orgId: req.params.orgId,
          prefix: key.prefix,
        });
      }
      return { revoked: true };
    },
  );
};
