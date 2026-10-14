import type { RedisClient } from '../../lib/redis';

/** PRD §7.3: a provider with ≥5 failures in 60s stays "open" (skipped) for 30s. */
export const CB_FAILURES = 5;
export const CB_WINDOW_MS = 60_000;
export const CB_OPEN_MS = 30_000;

const RECORD = `
local n = redis.call('INCR', KEYS[1])
if n == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
if n >= tonumber(ARGV[2]) then
  redis.call('SET', KEYS[2], '1', 'PX', ARGV[3])
  redis.call('DEL', KEYS[1])
end
return n
`;

export function createCircuitBreaker(redis: RedisClient) {
  return {
    async isOpen(providerId: string): Promise<boolean> {
      try {
        return (await redis.exists(`cb:open:${providerId}`)) === 1;
      } catch {
        return false; // Redis down: fail open (keep serving) rather than block traffic
      }
    },
    async recordFailure(providerId: string): Promise<void> {
      try {
        await redis.eval(
          RECORD,
          2,
          `cb:fail:${providerId}`,
          `cb:open:${providerId}`,
          CB_WINDOW_MS,
          CB_FAILURES,
          CB_OPEN_MS,
        );
      } catch {}
    },
  };
}

export type CircuitBreaker = ReturnType<typeof createCircuitBreaker>;
