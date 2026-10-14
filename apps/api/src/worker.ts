/**
 * Background worker (same image as the API, `node dist/worker.js`).
 * Phase 3: releases orphaned balance holds every 5 minutes (PRD §7.4 step 6).
 * Moves to BullMQ repeatable jobs once Redis is wired in (see docs/DECISIONS.md D-031).
 */
import { prisma } from '@fuseai/db';
import pino from 'pino';
import { releaseExpiredHolds } from './modules/billing/wallet';

const INTERVAL_MS = 5 * 60 * 1000;
const log = pino({ name: 'fuseai-worker', level: process.env.LOG_LEVEL ?? 'info' });

let running = false;
async function cleanupHolds() {
  if (running) return;
  running = true;
  try {
    const released = await releaseExpiredHolds(prisma);
    if (released > 0) log.warn({ released }, 'released orphaned holds');
  } catch (err) {
    log.error({ err }, 'hold cleanup failed');
  } finally {
    running = false;
  }
}

await cleanupHolds();
const timer = setInterval(cleanupHolds, INTERVAL_MS);
log.info({ intervalMs: INTERVAL_MS }, 'worker started');

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    clearInterval(timer);
    await prisma.$disconnect();
    process.exit(0);
  });
}
