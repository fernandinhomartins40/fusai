import type { PrismaClient } from '@fuseai/db';
import { microsToBrl } from '@fuseai/shared';
import type { FastifyError, FastifyPluginAsync } from 'fastify';
import { hasZodFastifySchemaValidationErrors } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { priceModel } from '../../lib/model-pricing';
import type { RedisClient } from '../../lib/redis';
import type { SettingsStore } from '../../lib/settings';
import type { PaymentProvider } from '../../payments/types';
import { createGatewayAuth, type GatewayContext, requireScope, requireSecretKey } from './auth';
import { type CatalogStore, isServable } from './catalog';
import { chatBodySchema, createChatHandler } from './chat';
import type { CircuitBreaker } from './circuit-breaker';
import { endUserRoutes } from './end-users';
import { GatewayError } from './errors';

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
    const [{ bySlug }, s] = await Promise.all([catalog.get(), settings.get()]);
    const markup = ctx.org.markupOverride?.toFixed() ?? null;
    const data = [...bySlug.values()]
      .filter(isServable)
      .filter(
        (e) =>
          ctx.project.allowedModelIds.length === 0 ||
          ctx.project.allowedModelIds.includes(e.model.id),
      )
      .map((e) => ({ e, prices: priceModel(e.model, s, markup) }))
      .filter(
        ({ prices }) =>
          ctx.env === 'LIVE' || prices.outputPerM <= BigInt(s.test_key_max_output_micros),
      )
      .sort(
        (a, b) =>
          a.e.model.sortOrder - b.e.model.sortOrder || a.e.model.slug.localeCompare(b.e.model.slug),
      )
      .map(({ e, prices }) => ({
        id: e.model.slug,
        object: 'model',
        created: 0,
        owned_by: 'fuseai',
        name: e.model.displayName,
        description: e.model.description,
        context_window: e.model.contextWindow,
        max_output_tokens: e.model.maxOutputTokens,
        capabilities: {
          tools: e.model.supportsTools,
          vision: e.model.supportsVision,
          reasoning: e.model.supportsReasoning,
        },
        pricing: {
          currency: 'BRL',
          unit: '1M tokens',
          input: microsToBrl(prices.inputPerM),
          cached_input: microsToBrl(prices.cachedInputPerM),
          output: microsToBrl(prices.outputPerM),
        },
      }));
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
    const to = query.to ? new Date(query.to) : new Date();
    const from = query.from ? new Date(query.from) : new Date(to.getTime() - 30 * 86_400_000);
    if (from > to || to.getTime() - from.getTime() > 366 * 86_400_000) {
      throw new GatewayError(400, 'invalid_range', 'Período inválido (máximo de 366 dias).');
    }
    const [rows, { byId }] = await Promise.all([
      prisma.usageLog.groupBy({
        by: ['modelId'],
        where: { projectId: ctx.project.id, createdAt: { gte: from, lt: to } },
        _count: { _all: true },
        _sum: {
          promptTokens: true,
          cachedTokens: true,
          completionTokens: true,
          chargedMicros: true,
        },
      }),
      catalog.get(),
    ]);
    const byModel = rows.map((r) => ({
      model: byId.get(r.modelId)?.model.slug ?? r.modelId,
      requests: r._count._all,
      prompt_tokens: r._sum.promptTokens ?? 0,
      cached_tokens: r._sum.cachedTokens ?? 0,
      completion_tokens: r._sum.completionTokens ?? 0,
      charged_micros: (r._sum.chargedMicros ?? 0n).toString(),
    }));
    const total = byModel.reduce(
      (acc, m) => ({
        requests: acc.requests + m.requests,
        prompt_tokens: acc.prompt_tokens + m.prompt_tokens,
        completion_tokens: acc.completion_tokens + m.completion_tokens,
        charged_micros: acc.charged_micros + BigInt(m.charged_micros),
      }),
      { requests: 0, prompt_tokens: 0, completion_tokens: 0, charged_micros: 0n },
    );
    return {
      object: 'usage',
      currency: 'BRL',
      from: from.toISOString(),
      to: to.toISOString(),
      total: {
        ...total,
        charged: microsToBrl(total.charged_micros),
        charged_micros: total.charged_micros.toString(),
      },
      by_model: byModel,
    };
  });
};
