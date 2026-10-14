import { randomUUID } from 'node:crypto';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import { prisma as defaultPrisma, type PrismaClient } from '@fuseai/db';
import Fastify, { type FastifyError } from 'fastify';
import {
  hasZodFastifySchemaValidationErrors,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import secureJson from 'secure-json-parse';
import { parseEncryptionKey } from './lib/crypto';
import type { Env } from './lib/env';
import { HttpError } from './lib/errors';
import { loggerOptions } from './lib/logger';
import { createSmtpMailer, type Mailer } from './lib/mailer';
import { createRedis, type RedisClient } from './lib/redis';
import { sessionGuards } from './lib/session';
import { createSettingsStore } from './lib/settings';
import { adminRoutes } from './modules/admin/routes';
import { createAuth } from './modules/auth/auth';
import { authRoutes } from './modules/auth/routes';
import { dashboardRoutes } from './modules/dashboard/routes';
import { createCatalog } from './modules/gateway/catalog';
import { createCircuitBreaker } from './modules/gateway/circuit-breaker';
import { gatewayRoutes } from './modules/gateway/routes';
import { healthRoutes } from './modules/health/routes';

declare module 'fastify' {
  interface FastifyInstance {
    caches: { invalidate(): void };
  }
}

export type AppDeps = { prisma?: PrismaClient; mailer?: Mailer; redis?: RedisClient };

export async function buildApp(env: Env, deps: AppDeps = {}) {
  const prisma = deps.prisma ?? defaultPrisma;
  const mailer = deps.mailer ?? createSmtpMailer(env);
  const redis = deps.redis ?? createRedis(env.REDIS_URL);
  const auth = createAuth(env, prisma, mailer, redis);
  const guards = sessionGuards(env, auth);
  const settings = createSettingsStore(prisma);
  const encryptionKey = parseEncryptionKey(env.ENCRYPTION_KEY);
  const catalog = createCatalog(prisma, encryptionKey);
  const breaker = createCircuitBreaker(redis);

  const app = Fastify({
    logger: loggerOptions(env),
    genReqId: (req) => {
      const incoming = req.headers['x-request-id'];
      return typeof incoming === 'string' && incoming.length <= 64 ? incoming : randomUUID();
    },
    requestIdHeader: false,
    trustProxy: true,
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  // Same as Fastify's JSON parser (prototype-poisoning safe), but an empty body is accepted
  // as "no body" — many clients send `content-type: application/json` on bodiless POSTs.
  app.removeContentTypeParser('application/json');
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
    if (body === '') return done(null, undefined);
    try {
      done(
        null,
        secureJson.parse(body as string, { protoAction: 'error', constructorAction: 'error' }),
      );
    } catch {
      done(
        Object.assign(new Error('JSON inválido'), { statusCode: 400, code: 'invalid_json' }),
        undefined,
      );
    }
  });

  app.setErrorHandler<FastifyError>((err, req, reply) => {
    if (err instanceof HttpError) {
      return reply.status(err.statusCode).send({ error: { message: err.message, code: err.code } });
    }
    if (hasZodFastifySchemaValidationErrors(err)) {
      const first = err.validation[0];
      return reply.status(400).send({
        error: {
          message: first?.message ?? 'Dados inválidos',
          code: 'invalid_request',
          details: err.validation.map((v) => ({ path: v.instancePath, message: v.message })),
        },
      });
    }
    const status = err.statusCode && err.statusCode < 500 ? err.statusCode : 500;
    if (status >= 500) req.log.error(err);
    return reply.status(status).send({
      error: {
        message: status >= 500 ? 'Erro interno' : err.message,
        code: status >= 500 ? 'internal_error' : (err.code ?? 'bad_request'),
      },
    });
  });

  app.addHook('onSend', async (req, reply) => {
    reply.header('x-request-id', req.id);
  });

  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cors, { origin: [env.APP_URL], credentials: true });

  await app.register(healthRoutes);
  await app.register(authRoutes, { auth });
  await app.register(dashboardRoutes, { prisma, env, guards, settings });
  await app.register(adminRoutes, { prisma, env, guards, settings, encryptionKey, catalog });
  await app.register(gatewayRoutes, {
    prefix: '/v1',
    prisma,
    catalog,
    settings,
    breaker,
    redis,
    keyPepper: env.KEY_PEPPER,
  });

  // In-memory caches (catalog 10s, settings 60s); exposed so tests can reset them.
  app.decorate('caches', {
    invalidate() {
      catalog.invalidate();
      settings.invalidate();
    },
  });

  if (!deps.redis) app.addHook('onClose', async () => void (await redis.quit()));

  return app;
}
