/**
 * Background worker (same image as the API, `node dist/worker.js`), driven by BullMQ.
 * Jobs on the `jobs` queue:
 * - process-webhook  (enqueued by POST /webhooks/asaas): credit / refund / expire a payment
 * - expire-payments  (every 1 min): cancel unpaid Pix past its deadline
 * - sweep-webhooks   (every 2 min): retry webhook events that were stored but not processed
 * - release-holds    (every 5 min): release orphaned balance holds (PRD §7.4 step 6)
 */
import { prisma } from '@fuseai/db';
import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import pino from 'pino';
import { loadEnv } from './lib/env';
import { BULL_PREFIX, JOBS_QUEUE } from './lib/jobs';
import { createSmtpMailer } from './lib/mailer';
import { releaseExpiredHolds } from './modules/billing/wallet';
import { notifyPaymentCredited } from './modules/payments/notify';
import {
  expirePendingPayments,
  processPendingWebhookEvents,
  processWebhookEvent,
} from './modules/payments/service';
import { createPaymentProvider } from './payments';

const env = loadEnv();
const log = pino({ name: 'fuseai-worker', level: env.LOG_LEVEL });
const provider = createPaymentProvider(env);
const mailer = createSmtpMailer(env);
const hooks = {
  onCredited: (payment: Parameters<typeof notifyPaymentCredited>[3]) =>
    notifyPaymentCredited(prisma, mailer, env.APP_URL, payment),
};

const connection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
const queue = new Queue(JOBS_QUEUE, { connection, prefix: BULL_PREFIX });
const keep = { removeOnComplete: 100, removeOnFail: 500 };

const schedules = [
  ['release-holds', 5 * 60_000],
  ['expire-payments', 60_000],
  ['sweep-webhooks', 2 * 60_000],
] as const;
for (const [name, every] of schedules) {
  await queue.upsertJobScheduler(name, { every }, { name, opts: keep });
}
// Repeatable jobs first fire after one interval: also run the maintenance once at startup.
await queue.add('release-holds', {}, keep);
await queue.add('sweep-webhooks', {}, keep);

const worker = new Worker(
  JOBS_QUEUE,
  async (job) => {
    switch (job.name) {
      case 'process-webhook':
        await processWebhookEvent(prisma, provider, String(job.data.eventId), hooks);
        return null;
      case 'expire-payments': {
        const expired = await expirePendingPayments(prisma, provider);
        if (expired) log.info({ expired }, 'expired pix charges');
        return { expired };
      }
      case 'sweep-webhooks': {
        const swept = await processPendingWebhookEvents(prisma, provider, hooks, 60_000);
        if (swept) log.warn({ swept }, 'retried pending webhook events');
        return { swept };
      }
      case 'release-holds': {
        const released = await releaseExpiredHolds(prisma);
        if (released > 0) log.warn({ released }, 'released orphaned holds');
        return { released };
      }
      default:
        log.warn({ name: job.name }, 'unknown job');
        return null;
    }
  },
  { connection, prefix: BULL_PREFIX, concurrency: 4 },
);
worker.on('failed', (job, err) => log.error({ job: job?.name, err: err.message }, 'job failed'));
log.info({ queue: JOBS_QUEUE }, 'worker started');

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    await worker.close();
    await queue.close();
    await connection.quit();
    await prisma.$disconnect();
    process.exit(0);
  });
}
