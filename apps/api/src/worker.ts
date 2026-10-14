/**
 * Background worker (same image as the API, `node dist/worker.js`), driven by BullMQ.
 * Jobs:
 * - release-holds (every 5 min): releases orphaned balance holds (PRD §7.4 step 6).
 * Later phases add Pix expiration, outbound webhooks and e-mails to this queue.
 */
import { prisma } from '@fuseai/db';
import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import pino from 'pino';
import { releaseExpiredHolds } from './modules/billing/wallet';

const QUEUE = 'maintenance';
const PREFIX = 'fuse:bull';
const HOLD_CLEANUP_EVERY_MS = 5 * 60 * 1000;

const log = pino({ name: 'fuseai-worker', level: process.env.LOG_LEVEL ?? 'info' });
const connection = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
  maxRetriesPerRequest: null, // required by BullMQ workers
});

const queue = new Queue(QUEUE, { connection, prefix: PREFIX });
// A repeatable job first fires after one interval: run the cleanup once at startup too.
await queue.add('release-holds', {}, { removeOnComplete: 100, removeOnFail: 500 });
await queue.upsertJobScheduler(
  'release-holds',
  { every: HOLD_CLEANUP_EVERY_MS },
  { name: 'release-holds', opts: { removeOnComplete: 100, removeOnFail: 500 } },
);

const worker = new Worker(
  QUEUE,
  async (job) => {
    if (job.name === 'release-holds') {
      const released = await releaseExpiredHolds(prisma);
      if (released > 0) log.warn({ released }, 'released orphaned holds');
      return { released };
    }
    log.warn({ name: job.name }, 'unknown job');
    return null;
  },
  { connection, prefix: PREFIX, concurrency: 1 },
);
worker.on('failed', (job, err) => log.error({ job: job?.name, err }, 'job failed'));
log.info({ queue: QUEUE }, 'worker started');

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    await worker.close();
    await queue.close();
    await connection.quit();
    await prisma.$disconnect();
    process.exit(0);
  });
}
