import type { PrismaClient } from '@fusai/db';
import { microsToBrl } from '@fusai/shared';
import type { FastifyError, FastifyPluginAsync } from 'fastify';
import { hasZodFastifySchemaValidationErrors } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Mailer } from '../../lib/mailer';
import type { RedisClient } from '../../lib/redis';
import type { SettingsStore } from '../../lib/settings';
import { untilNow } from '../../lib/time';
import type { PaymentProvider } from '../../payments/types';
import { createGatewayAuth, type GatewayContext, requireScope, requireSecretKey } from './auth';
import type { CatalogStore } from './catalog';
import { chatBodySchema, createChatHandler } from './chat';
import type { CircuitBreaker } from './circuit-breaker';
import { endUserRoutes } from './end-users';
import { GatewayError } from './errors';
import { listModelsFor, usageSummary } from './queries';
import { topupRoutes } from './topups';

type Options = {
  prisma: PrismaClient;
  catalog: CatalogStore;
  settings: SettingsStore;
  breaker: CircuitBreaker;
  redis: RedisClient;
  keyPepper: string;
  sessionSecret: string;
  provider: PaymentProvider;
  appUrl: string;
  mailer: Mailer;
};

const usageQuery = z.object({
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
});

/** Public OpenAI-compatible gateway (PRD §7.1). Errors use `{ error: { message, type, code } }`. */
export const gatewayRoutes: FastifyPluginAsync<Options> = async (app, opts) => {
  const { prisma, catalog, settings } = opts;
  const authenticate = createGatewayAuth(prisma, opts.keyPepper, opts.sessionSecret);
  const chat = createChatHandler(opts);
  const ctxOf = (req: { gateway?: GatewayContext }) => req.gateway as GatewayContext;

  // Authenticate before the body is parsed (unauthenticated callers never cost a parse).
  app.addHook('onRequest', async (req) => {
    await authenticate(req);
  });

  app.setErrorHandler<FastifyError>((err, req, reply) => {
    if (err instanceof GatewayError) {
      return reply.status(err.statusCode).headers(err.headers).send(err.toBody());
    }
    if (hasZodFastifySchemaValidationErrors(err)) {
      const first = err.validation[0];
      const path = first?.instancePath?.replace(/^\//, '').replaceAll('/', '.') ?? '';
      return reply.status(400).send({
        error: {
          message: `${path ? `${path}: ` : ''}${first?.message ?? 'Requisição inválida'}`,
          type: 'invalid_request_error',
          code: 'invalid_request',
        },
      });
    }
    if (err.statusCode && err.statusCode < 500) {
      return reply.status(err.statusCode).send({
        error: {
          message: err.message,
          type: 'invalid_request_error',
          code: err.code ?? 'invalid_request',
        },
      });
    }
    req.log.error({ err }, 'gateway error');
    return reply
      .status(500)
      .send({ error: { message: 'Erro interno', type: 'api_error', code: 'internal_error' } });
  });

  app.setNotFoundHandler((req, reply) =>
    reply.status(404).send({
      error: {
        message: `Rota não encontrada: ${req.method} ${req.url}`,
        type: 'invalid_request_error',
        code: 'not_found',
      },
    }),
  );

  app.get('/models', async (req) => {
    const ctx = ctxOf(req);
    requireScope(ctx, 'chat');
    const data = await listModelsFor(ctx, catalog, settings);
    return { object: 'list', data };
  });

  app.post(
    '/chat/completions',
    { schema: { body: chatBodySchema }, bodyLimit: 20 * 1024 * 1024 },
    async (req, reply) => {
      const ctx = ctxOf(req);
      requireScope(ctx, 'chat');
      return chat(req, reply, ctx);
    },
  );

  await app.register(endUserRoutes, {
    prisma,
    provider: opts.provider,
    sessionSecret: opts.sessionSecret,
    appUrl: opts.appUrl,
  });
  await app.register(topupRoutes, {
    prisma,
    provider: opts.provider,
    settings,
    appUrl: opts.appUrl,
  });

  app.get('/balance', async (req) => {
    const ctx = ctxOf(req);
    requireScope(ctx, 'billing:read');
    // End user (session token or X-Fuse-User): their own credits. Otherwise the organization's.
    const wallet = ctx.appUser
      ? await prisma.wallet.findUnique({ where: { appUserId: ctx.appUser.id } })
      : await prisma.wallet.findUnique({ where: { orgId: ctx.org.id } });
    if (!wallet) throw new GatewayError(404, 'wallet_not_found', 'Carteira não encontrada.');
    const available = wallet.balanceMicros - wallet.reservedMicros;
    return {
      object: 'balance',
      currency: 'BRL',
      owner: ctx.appUser ? 'app_user' : 'organization',
      billing_type: ctx.appUser ? ctx.project.billingMode : ctx.org.billingType,
      balance: microsToBrl(wallet.balanceMicros),
      reserved: microsToBrl(wallet.reservedMicros),
      available: microsToBrl(available),
      balance_micros: wallet.balanceMicros.toString(),
      reserved_micros: wallet.reservedMicros.toString(),
      available_micros: available.toString(),
    };
  });

  app.get('/usage', { schema: { querystring: usageQuery } }, async (req) => {
    const ctx = ctxOf(req);
    requireSecretKey(ctx); // project-wide usage: never for an end user's session token
    requireScope(ctx, 'billing:read');
    const query = req.query as z.infer<typeof usageQuery>;
    const to = query.to ? new Date(query.to) : untilNow();
    const from = query.from ? new Date(query.from) : new Date(to.getTime() - 30 * 86_400_000);
    if (from > to || to.getTime() - from.getTime() > 366 * 86_400_000) {
      throw new GatewayError(400, 'invalid_range', 'Período inválido (máximo de 366 dias).');
    }
    return usageSummary(prisma, catalog, ctx.project.id, from, to);
  });
};
