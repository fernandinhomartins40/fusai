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
import type { Env } from './lib/env';
import { HttpError } from './lib/errors';
import { loggerOptions } from './lib/logger';
import { createSmtpMailer, type Mailer } from './lib/mailer';
import { sessionGuards } from './lib/session';
import { adminRoutes } from './modules/admin/routes';
import { createAuth } from './modules/auth/auth';
import { authRoutes } from './modules/auth/routes';
import { dashboardRoutes } from './modules/dashboard/routes';
import { healthRoutes } from './modules/health/routes';

export type AppDeps = { prisma?: PrismaClient; mailer?: Mailer };

export async function buildApp(env: Env, deps: AppDeps = {}) {
  const prisma = deps.prisma ?? defaultPrisma;
  const mailer = deps.mailer ?? createSmtpMailer(env);
  const auth = createAuth(env, prisma, mailer);
  const guards = sessionGuards(env, auth);

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
  await app.register(dashboardRoutes, { prisma, guards });
  await app.register(adminRoutes, { prisma, guards });

  return app;
}
