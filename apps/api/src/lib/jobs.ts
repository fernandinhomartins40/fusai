import { Queue } from 'bullmq';
import { Redis } from 'ioredis';

/** One BullMQ queue for background work; the worker (src/worker.ts) consumes it. */
export const JOBS_QUEUE = 'jobs';
export const BULL_PREFIX = 'fuse:bull';

export type JobName =
  | 'process-webhook'
  | 'release-holds'
  | 'expire-payments'
  | 'sweep-webhooks'
  | 'deliver-webhooks';

export type JobCounts = Record<'waiting' | 'active' | 'delayed' | 'failed' | 'completed', number>;

export interface JobQueue {
  add(name: JobName, data: Record<string, unknown>): Promise<void>;
  /** Queue depth for the admin "Sistema" page. */
  counts(): Promise<JobCounts>;
  close(): Promise<void>;
}

export function createJobQueue(redisUrl: string): JobQueue {
  const connection = new Redis(redisUrl, { maxRetriesPerRequest: null });
  const queue = new Queue(JOBS_QUEUE, { connection, prefix: BULL_PREFIX });
  return {
    async add(name, data) {
      await queue.add(name, data, {
        attempts: 5,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: 1000,
        removeOnFail: 5000,
      });
    },
    async counts() {
      const c = await queue.getJobCounts('waiting', 'active', 'delayed', 'failed', 'completed');
      return {
        waiting: c.waiting ?? 0,
        active: c.active ?? 0,
        delayed: c.delayed ?? 0,
        failed: c.failed ?? 0,
        completed: c.completed ?? 0,
      };
    },
    async close() {
      await queue.close();
      await connection.quit();
    },
  };
}

/** In-memory queue for tests: records what would have been enqueued. */
export function createMemoryJobQueue(): JobQueue & {
  jobs: { name: JobName; data: Record<string, unknown> }[];
} {
  const jobs: { name: JobName; data: Record<string, unknown> }[] = [];
  return {
    jobs,
    async add(name, data) {
      jobs.push({ name, data });
    },
    async counts() {
      return { waiting: jobs.length, active: 0, delayed: 0, failed: 0, completed: 0 };
    },
    async close() {},
  };
}
