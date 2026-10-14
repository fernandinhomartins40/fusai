import { Redis } from 'ioredis';

/**
 * Shared Redis connection (rate limits, circuit breaker, queues).
 * `keyPrefix` isolates environments/tests that share a server.
 */
export function createRedis(url: string, keyPrefix = 'fuse:') {
  return new Redis(url, {
    keyPrefix,
    maxRetriesPerRequest: 2,
    enableOfflineQueue: true,
    lazyConnect: false,
  });
}

export type RedisClient = Redis;
