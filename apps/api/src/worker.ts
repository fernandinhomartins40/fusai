/**
 * Background worker (same image as the API, `node dist/worker.js`), driven by BullMQ.
 * Jobs on the `jobs` queue:
 * - process-webhook  (enqueued by POST /webhooks/asaas): credit / refund / expire a payment
 * - expire-payments  (every 1 min): cancel unpaid Pix past its deadline
 * - sweep-webhooks   (every 2 min): retry webhook events that were stored but not processed
 * - release-holds    (every 5 min): release orphaned balance holds (PRD §7.4 step 6)
 * - deliver-webhooks (every 30 s, and right after a payment event): signed webhooks to customers
 * - privacy          (every 1 h): anonymize accounts past the deletion grace period; log retention
 */
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prisma } from '@fusai/db';
import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import pino from 'pino';
import { parseEncryptionKey } from './lib/crypto';
import { loadEnv } from './lib/env';
import { BULL_PREFIX, JOBS_QUEUE } from './lib/jobs';
import { createMailer } from './lib/mailer';
import { releaseExpiredHolds } from './modules/billing/wallet';
import { notifyPaymentCredited } from './modules/payments/notify';
import {
  expirePendingPayments,
  processPendingWebhookEvents,
  processWebhookEvent,
  reconcilePayments,
} from './modules/payments/service';
import { anonymizeDueAccounts } from './modules/privacy/deletion';
import { purgeExpiredData } from './modules/privacy/retention';
import { deliverDueWebhooks } from './modules/webhooks-out/service';
import { createPaymentProvider } from './payments';

const env = loadEnv();
const log = pino({ name: 'fuseai-worker', level: env.LOG_LEVEL });
const provider = createPaymentProvider(env);
const mailer = createMailer(env);
const deliverOpts = {
  encryptionKey: parseEncryptionKey(env.ENCRYPTION_KEY),
  production: env.NODE_ENV === 'production',
};
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
  ['deliver-webhooks', 30_000],
  // Late Pix and chargebacks (PIE R-11): a light pass, it calls the PSP once per payment.
  ['reconcile-payments', 30 * 60_000],
  ['privacy', 60 * 60_000],
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
        await deliverDueWebhooks(prisma, deliverOpts); // payment.received etc. without waiting
        return null;
      case 'deliver-webhooks': {
        const delivered = await deliverDueWebhooks(prisma, deliverOpts);
        return { delivered };
      }
      case 'expire-payments': {
        const expired = await expirePendingPayments(prisma, provider);
        if (expired) log.info({ expired }, 'expired pix charges');
        return { expired };
      }
      case 'reconcile-payments': {
        const result = await reconcilePayments(prisma, provider, hooks);
        if (result.credited) log.warn(result, 'credited late payments');
        return result;
      }
      case 'sweep-webhooks': {
        const swept = await processPendingWebhookEvents(prisma, provider, hooks, 60_000);
        if (swept) log.warn({ swept }, 'retried pending webhook events');
        return { swept };
      }
      case 'privacy': {
        const deletion = await anonymizeDueAccounts(prisma);
        if (deletion.anonymized.length)
          log.info({ count: deletion.anonymized.length }, 'accounts anonymized');
        if (deletion.blocked.length)
          log.warn({ userIds: deletion.blocked }, 'account deletion blocked');
        const purged = await purgeExpiredData(prisma);
        if (purged) log.info(purged, 'retention purge');
        return { ...deletion, purged };
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

// Liveness (PIE V-05). Every finished job (deliver-webhooks runs every 30 s) refreshes a
// heartbeat file read by the container healthcheck. A worker that is alive but stuck (Redis
// connection hung, event loop blocked) stops beating: after STALL_MS it exits and Docker's
// restart policy brings it back, since Docker never restarts a merely "unhealthy" container.
const HEARTBEAT_FILE = join(tmpdir(), 'fusai-worker-heartbeat');
const STALL_MS = 3 * 60_000;
let lastBeat = Date.now();
const beat = () => {
  lastBeat = Date.now();
  writeFile(HEARTBEAT_FILE, String(lastBeat)).catch(() => {});
};
beat();
worker.on('completed', beat);
worker.on('failed', beat);
const watchdog = setInterval(() => {
  if (Date.now() - lastBeat < STALL_MS) return;
  log.error({ stalledMs: Date.now() - lastBeat }, 'no job finished recently; exiting to restart');
  process.exit(1);
}, 30_000);

// On deploy: jobs in progress finish (worker.close waits for them) within the compose
// `stop_grace_period`; a second signal does not start another close.
let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    if (stopping) return;
    stopping = true;
    clearInterval(watchdog);
    log.info({ signal }, 'shutting down: waiting for jobs in progress');
    await worker.close();
    await queue.close();
    await connection.quit();
    await prisma.$disconnect();
    process.exit(0);
  });
}
