import { prisma } from '@fusai/db';
import { buildApp } from './app';
import { loadEnv } from './lib/env';
import { closeGracefully } from './lib/shutdown';

/** Time for in-flight requests and streams on deploy; below the compose `stop_grace_period`. */
const SHUTDOWN_TIMEOUT_MS = 55_000;

const env = loadEnv();
const app = await buildApp(env);

let stopping = false;
const shutdown = async (signal: string) => {
  if (stopping) return;
  stopping = true;
  app.log.info({ signal }, 'shutting down: waiting for in-flight requests');
  const finished = await closeGracefully(app, SHUTDOWN_TIMEOUT_MS);
  if (!finished) app.log.warn('shutdown timeout: remaining connections were closed');
  await prisma.$disconnect().catch(() => {});
  process.exit(0);
};
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

try {
  await app.listen({ host: env.HOST, port: env.PORT });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
