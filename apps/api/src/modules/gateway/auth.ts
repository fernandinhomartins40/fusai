import type { ApiKey, Organization, PrismaClient, Project, Wallet } from '@fuseai/db';
import type { FastifyRequest } from 'fastify';
import { type ApiKeyScope, hashApiKey, hashesEqual, looksLikeApiKey } from '../api-keys/keys';
import { GatewayError, invalidApiKey } from './errors';

export type GatewayContext = {
  key: ApiKey;
  project: Project;
  org: Organization & { wallet: Wallet | null };
};

declare module 'fastify' {
  interface FastifyRequest {
    gateway?: GatewayContext;
  }
}

const LAST_USED_THROTTLE_MS = 60_000;

/** Resolves `Authorization: Bearer fai_...` into key + project + organization. */
export function createGatewayAuth(prisma: PrismaClient, pepper: string) {
  return async function authenticate(req: FastifyRequest): Promise<GatewayContext> {
    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    if (!token) throw invalidApiKey('Envie a chave no header Authorization: Bearer fai_live_...');
    if (!looksLikeApiKey(token)) throw invalidApiKey();

    const hash = hashApiKey(token, pepper);
    const key = await prisma.apiKey.findUnique({
      where: { hash },
      include: { project: { include: { org: { include: { wallet: true } } } } },
    });
    if (!key || !hashesEqual(key.hash, hash)) throw invalidApiKey();
    if (key.revokedAt) throw invalidApiKey('Esta chave foi revogada.');
    if (key.expiresAt && key.expiresAt.getTime() <= Date.now())
      throw invalidApiKey('Esta chave expirou.');

    const { project, ...apiKey } = key;
    const { org, ...proj } = project;
    if (org.status === 'SUSPENDED') {
      throw new GatewayError(
        403,
        'account_suspended',
        'Conta suspensa. Fale com o suporte da FuseAI.',
      );
    }

    if (!apiKey.lastUsedAt || Date.now() - apiKey.lastUsedAt.getTime() > LAST_USED_THROTTLE_MS) {
      prisma.apiKey
        .update({ where: { id: apiKey.id }, data: { lastUsedAt: new Date() } })
        .catch((err) => req.log.warn({ err }, 'failed to update lastUsedAt'));
    }

    const ctx: GatewayContext = { key: apiKey, project: proj, org };
    req.gateway = ctx;
    return ctx;
  };
}

export function requireScope(ctx: GatewayContext, scope: ApiKeyScope) {
  if (!ctx.key.scopes.includes(scope)) {
    throw new GatewayError(403, 'insufficient_scope', `Esta chave não tem o escopo "${scope}".`);
  }
}
