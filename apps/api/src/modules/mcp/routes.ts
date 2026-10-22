import type { PrismaClient } from '@fusai/db';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import type { Env } from '../../lib/env';
import type { Mailer } from '../../lib/mailer';
import { slidingWindow } from '../../lib/rate-limit';
import type { RedisClient } from '../../lib/redis';
import type { SettingsStore } from '../../lib/settings';
import type { PaymentProvider } from '../../payments/types';
import { hashApiKey, hashesEqual, looksLikeAgentKey } from '../api-keys/keys';
import { createGatewayAuth, requireScope, requireSecretKey } from '../gateway/auth';
import type { CatalogStore } from '../gateway/catalog';
import { GatewayError } from '../gateway/errors';
import { type AgentContext, buildAgentMcpServer } from './agent-server';
import { buildMcpServer } from './server';

type Options = {
  prisma: PrismaClient;
  catalog: CatalogStore;
  settings: SettingsStore;
  provider: PaymentProvider;
  redis: RedisClient;
  env: Env;
  encryptionKey: Buffer;
  mailer: Mailer;
};

const LAST_USED_THROTTLE_MS = 60_000;

/**
 * Remote MCP server (PRD §10.1): `POST /mcp`, Streamable HTTP, stateless. Two credentials:
 * - project API key with scope `mcp`: tools bound to that project;
 * - organization agent key (`fai_agent_`, D-123): configures the whole organization.
 */
export const mcpRoutes: FastifyPluginAsync<Options> = async (app, opts) => {
  const authenticate = createGatewayAuth(
    opts.prisma,
    opts.env.KEY_PEPPER,
    opts.env.SESSION_TOKEN_SECRET,
  );

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof GatewayError) {
      if (err.statusCode === 401) reply.header('www-authenticate', 'Bearer realm="fusai"');
      return reply.status(err.statusCode).headers(err.headers).send(err.toBody());
    }
    req.log.error({ err }, 'mcp error');
    return reply.status(500).send({
      jsonrpc: '2.0',
      error: { code: -32603, message: 'Erro interno' },
      id: null,
    });
  });

  /** Agent key → organization context, acting as its creator (still OWNER/ADMIN, org active). */
  async function authenticateAgent(
    token: string,
    origin: string | undefined,
  ): Promise<AgentContext> {
    const invalid = (message = 'Chave de agente inválida.') =>
      new GatewayError(401, 'invalid_api_key', message, 'authentication_error');
    if (origin) {
      throw new GatewayError(
        403,
        'secret_key_in_browser',
        'A chave de agente não pode ser usada no navegador.',
      );
    }
    const hash = hashApiKey(token, opts.env.KEY_PEPPER);
    const key = await opts.prisma.agentKey.findUnique({
      where: { hash },
      include: { org: { include: { wallet: true } } },
    });
    if (!key || !hashesEqual(key.hash, hash)) throw invalid();
    if (key.revokedAt) throw invalid('Esta chave de agente foi revogada.');
    const { org, ...agentKey } = key;
    if (org.status === 'SUSPENDED')
      throw new GatewayError(
        403,
        'account_suspended',
        'Conta suspensa. Fale com o suporte da fusai.',
      );
    const member = await opts.prisma.membership.findFirst({
      where: { orgId: org.id, userId: key.createdById, role: { in: ['OWNER', 'ADMIN'] } },
      include: { user: { select: { banned: true } } },
    });
    if (!member || member.user.banned)
      throw invalid('Quem criou esta chave não é mais dono ou admin da organização. Crie outra.');
    if (!key.lastUsedAt || Date.now() - key.lastUsedAt.getTime() > LAST_USED_THROTTLE_MS) {
      opts.prisma.agentKey
        .update({ where: { id: key.id }, data: { lastUsedAt: new Date() } })
        .catch(() => {});
    }
    return { key: agentKey, org, actorId: key.createdById };
  }

  app.post('/mcp', { bodyLimit: 1024 * 1024 }, async (req, reply) => {
    const bearer = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '').trim();
    if (looksLikeAgentKey(bearer)) {
      const agent = await authenticateAgent(bearer, req.headers.origin);
      await limit(`mcp:agent:${agent.key.id}`);
      const server = buildAgentMcpServer(agent, {
        prisma: opts.prisma,
        catalog: opts.catalog,
        settings: opts.settings,
        provider: opts.provider,
        env: opts.env,
        encryptionKey: opts.encryptionKey,
        ip: req.ip,
        mailer: opts.mailer,
      });
      return serve(server, req, reply);
    }

    const ctx = await authenticate(req);
    requireSecretKey(ctx);
    requireScope(ctx, 'mcp');
    await limit(`mcp:${ctx.key?.id}`);
    const server = buildMcpServer(ctx, {
      prisma: opts.prisma,
      catalog: opts.catalog,
      settings: opts.settings,
      provider: opts.provider,
      env: opts.env,
      encryptionKey: opts.encryptionKey,
      mailer: opts.mailer,
      inject: (o) => app.inject(o),
      authorization: req.headers.authorization ?? '',
      ip: req.ip,
    });
    return serve(server, req, reply);
  });

  async function limit(bucket: string) {
    const rl = await slidingWindow(opts.redis, bucket, 120, 60_000).catch(() => null);
    if (rl && !rl.allowed) {
      throw new GatewayError(
        429,
        'rate_limited',
        'Muitas chamadas MCP por minuto.',
        'rate_limit_error',
        { 'retry-after': String(Math.max(1, Math.ceil(rl.retryAfterMs / 1000))) },
      );
    }
  }

  /** Stateless: a fresh transport per request, JSON responses (no session, no SSE stream). */
  async function serve(
    server: { connect: McpServer['connect']; close: McpServer['close'] },
    req: FastifyRequest,
    reply: FastifyReply,
  ) {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    reply.hijack();
    reply.raw.on('close', () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req.raw, reply.raw, req.body);
  }

  // Stateless server: no SSE stream to resume and no session to delete.
  const notAllowed = async (_req: unknown, reply: import('fastify').FastifyReply) =>
    reply
      .status(405)
      .header('allow', 'POST')
      .send({
        jsonrpc: '2.0',
        error: { code: -32000, message: 'Método não permitido.' },
        id: null,
      });
  app.get('/mcp', notAllowed);
  app.delete('/mcp', notAllowed);
};
