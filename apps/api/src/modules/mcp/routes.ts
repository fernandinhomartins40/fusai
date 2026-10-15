import type { PrismaClient } from '@fuseai/db';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { FastifyPluginAsync } from 'fastify';
import type { Env } from '../../lib/env';
import { slidingWindow } from '../../lib/rate-limit';
import type { RedisClient } from '../../lib/redis';
import type { SettingsStore } from '../../lib/settings';
import type { PaymentProvider } from '../../payments/types';
import { createGatewayAuth, requireScope, requireSecretKey } from '../gateway/auth';
import type { CatalogStore } from '../gateway/catalog';
import { GatewayError } from '../gateway/errors';
import { buildMcpServer } from './server';

type Options = {
  prisma: PrismaClient;
  catalog: CatalogStore;
  settings: SettingsStore;
  provider: PaymentProvider;
  redis: RedisClient;
  env: Env;
  encryptionKey: Buffer;
};

/** Remote MCP server (PRD §10.1): `POST /mcp`, Streamable HTTP, stateless, project API key with scope `mcp`. */
export const mcpRoutes: FastifyPluginAsync<Options> = async (app, opts) => {
  const authenticate = createGatewayAuth(
    opts.prisma,
    opts.env.KEY_PEPPER,
    opts.env.SESSION_TOKEN_SECRET,
  );

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof GatewayError) {
      if (err.statusCode === 401) reply.header('www-authenticate', 'Bearer realm="fuseai"');
      return reply.status(err.statusCode).headers(err.headers).send(err.toBody());
    }
    req.log.error({ err }, 'mcp error');
    return reply.status(500).send({
      jsonrpc: '2.0',
      error: { code: -32603, message: 'Erro interno' },
      id: null,
    });
  });

  app.post('/mcp', { bodyLimit: 1024 * 1024 }, async (req, reply) => {
    const ctx = await authenticate(req);
    requireSecretKey(ctx);
    requireScope(ctx, 'mcp');
    const rl = await slidingWindow(opts.redis, `mcp:${ctx.key?.id}`, 120, 60_000).catch(() => null);
    if (rl && !rl.allowed) {
      throw new GatewayError(
        429,
        'rate_limited',
        'Muitas chamadas MCP por minuto.',
        'rate_limit_error',
        {
          'retry-after': String(Math.max(1, Math.ceil(rl.retryAfterMs / 1000))),
        },
      );
    }

    const server = buildMcpServer(ctx, {
      prisma: opts.prisma,
      catalog: opts.catalog,
      settings: opts.settings,
      provider: opts.provider,
      env: opts.env,
      encryptionKey: opts.encryptionKey,
      inject: (o) => app.inject(o),
      authorization: req.headers.authorization ?? '',
      ip: req.ip,
    });
    // Stateless: a fresh transport per request, JSON responses (no session, no SSE stream).
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
  });

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
