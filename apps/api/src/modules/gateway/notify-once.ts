import type { RedisClient } from '../../lib/redis';

/**
 * Runs `fn` at most once per `ttlSeconds` for a key (SET NX). Used so that threshold events
 * (balance.low, usage.limit_reached) do not flood customers on every request.
 * Fails silently: a notification must never break the request that triggered it.
 */
export async function notifyOnce(
  redis: RedisClient,
  key: string,
  fn: () => Promise<unknown>,
  ttlSeconds = 24 * 3600,
): Promise<boolean> {
  try {
    const first = await redis.set(`notify:${key}`, '1', 'EX', ttlSeconds, 'NX');
    if (first !== 'OK') return false;
    await fn();
    return true;
  } catch {
    return false;
  }
}
