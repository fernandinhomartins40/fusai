import { createHash } from 'node:crypto';
import type { RedisClient } from '../../lib/redis';

/**
 * Per-account cap on wrong passwords (S-05), on top of the per-IP limit: a botnet spread over
 * many IPs gets at most MAX_FAILURES guesses per window for one email. The lock is temporary
 * (it ends WINDOW_SECONDS after the first failure) and only blocks password sign-in; Google
 * sign-in and "esqueci a senha" keep working, so an attacker cannot lock the owner out for good.
 */
export const LOGIN_MAX_FAILURES = 10;
export const LOGIN_WINDOW_SECONDS = 15 * 60;

/** The email is hashed: Redis never holds personal data. */
function failureKey(email: string) {
  const hash = createHash('sha256').update(email.trim().toLowerCase()).digest('hex');
  return `auth:login-fail:${hash}`;
}

export function loginThrottle(redis: RedisClient) {
  return {
    async isLocked(email: string): Promise<boolean> {
      const count = Number(await redis.get(failureKey(email)));
      return count >= LOGIN_MAX_FAILURES;
    },
    /** Returns the failure count in the current window. */
    async recordFailure(email: string): Promise<number> {
      // Atomic, and a fixed window from the first failure: later failures do not extend the
      // lock, and the key never lives without a TTL.
      const count = await redis.eval(
        "local n = redis.call('INCR', KEYS[1]) if redis.call('TTL', KEYS[1]) < 0 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end return n",
        1,
        failureKey(email),
        LOGIN_WINDOW_SECONDS,
      );
      return Number(count);
    },
    async reset(email: string) {
      await redis.del(failureKey(email));
    },
  };
}
