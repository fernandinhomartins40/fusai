import { fromNodeHeaders } from 'better-auth/node';
import type { FastifyInstance } from 'fastify';
import type { Auth } from './auth';

/** Mounts the Better Auth handler at /api/auth/*. */
export async function authRoutes(app: FastifyInstance, opts: { auth: Auth }) {
  app.route({
    method: ['GET', 'POST'],
    url: '/api/auth/*',
    async handler(req, reply) {
      const url = new URL(req.url, `${req.protocol}://${req.host}`);
      const headers = fromNodeHeaders(req.headers);
      // Better Auth rate-limits by IP: hand it the proxy-resolved address, not a client header.
      headers.set('x-forwarded-for', req.ip);
      const request = new Request(url, {
        method: req.method,
        headers,
        body: req.body ? JSON.stringify(req.body) : undefined,
      });
      const response = await opts.auth.handler(request);

      reply.status(response.status);
      for (const [key, value] of response.headers) {
        if (key !== 'set-cookie') reply.header(key, value);
      }
      const cookies = response.headers.getSetCookie();
      if (cookies.length) reply.header('set-cookie', cookies);
      return reply.send(response.body ? await response.text() : null);
    },
  });
}
