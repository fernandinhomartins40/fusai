import { randomUUID } from 'node:crypto';
import type { RedisClient } from './redis';

/**
 * Sliding-window rate limit on a Redis sorted set, atomic via Lua:
 * drop entries older than the window, count, add this hit only if under the limit.
 */
const SCRIPT = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
redis.call('ZREMRANGEBYSCORE', key, 0, now - window)
local count = redis.call('ZCARD', key)
if count < limit then
  redis.call('ZADD', key, now, ARGV[4])
  redis.call('PEXPIRE', key, window)
  return {1, limit - count - 1, 0}
end
local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
local retry = window
if oldest[2] then retry = tonumber(oldest[2]) + window - now end
return {0, 0, retry}
`;

export type RateLimitResult = { allowed: boolean; remaining: number; retryAfterMs: number };

export async function slidingWindow(
  redis: RedisClient,
  key: string,
  limit: number,
  windowMs: number,
): Promise<RateLimitResult> {
  const [allowed, remaining, retry] = (await redis.eval(
    SCRIPT,
    1,
    `rl:${key}`,
    Date.now(),
    windowMs,
    limit,
    `${Date.now()}:${randomUUID()}`,
  )) as [number, number, number];
  return { allowed: allowed === 1, remaining, retryAfterMs: Math.max(0, retry) };
}

/** Adapter for Better Auth's `rateLimit.customStorage` (window in seconds). */
export function betterAuthRateLimitStorage(redis: RedisClient) {
  return {
    async consume(key: string, rule: { window: number; max: number }) {
      const r = await slidingWindow(redis, `auth:${key}`, rule.max, rule.window * 1000);
      return {
        allowed: r.allowed,
        retryAfter: r.allowed ? null : Math.ceil(r.retryAfterMs / 1000),
      };
    },
  };
}
