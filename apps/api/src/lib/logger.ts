import type { FastifyServerOptions } from 'fastify';
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
    ...(env.NODE_ENV === 'development'
      ? { transport: { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss' } } }
      : {}),
  };
}
