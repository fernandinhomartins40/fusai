import type { PrismaClient } from '@fusai/db';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { RedisClient } from '../../lib/redis';

const startedAt = Date.now();
const READY_TIMEOUT_MS = 2_000;

type HealthOptions = { prisma: PrismaClient; redis: RedisClient };

const check = z.enum(['ok', 'error']);
const readySchema = z.object({
  status: z.enum(['ok', 'unavailable']),
  service: z.literal('fuseai-api'),
  database: check,
  redis: check,
});

async function probe(work: () => Promise<unknown>): Promise<'ok' | 'error'> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('timeout')), READY_TIMEOUT_MS);
  });
  try {
    await Promise.race([work(), timeout]);
    return 'ok';
  } catch {
    return 'error';
  } finally {
    clearTimeout(timer);
  }
}

export const healthRoutes: FastifyPluginAsyncZod<HealthOptions> = async (
  app,
  { prisma, redis },
) => {
  // Liveness for Docker: the process answers. Does not touch Postgres or Redis, so a database
  // blip does not make Docker restart the API.
  app.get(
    '/health',
    {
      schema: {
        response: {
          200: z.object({
            status: z.literal('ok'),
            service: z.literal('fuseai-api'),
            uptimeSeconds: z.number().int(),
            time: z.string(),
          }),
        },
      },
    },
    async () => ({
      status: 'ok' as const,
      service: 'fuseai-api' as const,
      uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
      time: new Date().toISOString(),
    }),
  );

  // Readiness for the deploy (PIE V-05): Postgres and Redis answer within 2 s each.
  app.get(
    '/health/ready',
    { schema: { response: { 200: readySchema, 503: readySchema } } },
    async (_req, reply) => {
      const [database, cache] = await Promise.all([
        probe(() => prisma.$queryRaw`SELECT 1`),
        probe(() => redis.ping()),
      ]);
      const ok = database === 'ok' && cache === 'ok';
      return reply.status(ok ? 200 : 503).send({
        status: ok ? 'ok' : 'unavailable',
        service: 'fuseai-api',
        database,
        redis: cache,
      });
    },
  );
};
