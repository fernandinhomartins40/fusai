import type { FastifyRequest, FastifyServerOptions } from 'fastify';
import type { Env } from './env';

/** Never log credentials, tokens or message content. */
const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["asaas-access-token"]',
  'req.headers["x-fuse-signature"]',
  'res.headers["set-cookie"]',
];

export function loggerOptions(env: Env): FastifyServerOptions['logger'] {
  return {
    level: env.NODE_ENV === 'test' ? 'silent' : env.LOG_LEVEL,
    redact: { paths: REDACT_PATHS, censor: '[redacted]' },
    serializers: { req: serializeReq },
    ...(env.NODE_ENV === 'development'
      ? { transport: { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss' } } }
      : {}),
  };
}

/**
 * Logs the route pattern (`/internal/invitations/:token`), never the raw URL: invitation, email
 * verification and password reset tokens, checkout ids and query strings stay out of the logs.
 */
export function serializeReq(req: FastifyRequest) {
  return {
    method: req.method,
    url: req.routeOptions?.url ?? (req.url ?? '').split('?')[0]?.replace(/[^/]{24,}/g, ':id'),
    host: req.host,
    remoteAddress: req.ip,
  };
}
