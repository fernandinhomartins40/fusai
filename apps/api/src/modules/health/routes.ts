import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

const startedAt = Date.now();

export const healthRoutes: FastifyPluginAsyncZod = async (app) => {
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
};
