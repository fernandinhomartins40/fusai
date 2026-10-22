import { describe, expect, it } from 'vitest';
import { assertPublicUrl, isPrivateAddress } from './ssrf';

/**
 * PIE audit (S-02): negative tests for the outbound webhook SSRF guard.
 * Pure unit tests (no database). Expected to FAIL until the guard is fixed:
 * WHATWG URL normalizes `[::ffff:127.0.0.1]` to `[::ffff:7f00:1]`, which the
 * current `isPrivateAddress` does not recognize as loopback.
 */
describe('PIE S-02: SSRF guard must block IPv4-mapped IPv6 and reserved ranges', () => {
  it.each([
    '::ffff:7f00:1', // 127.0.0.1 (as normalized by new URL)
    '::ffff:a00:1', // 10.0.0.1
    '::ffff:a9fe:a9fe', // 169.254.169.254 (cloud metadata)
    '::ffff:c0a8:101', // 192.168.1.1
    '64:ff9b::7f00:1', // NAT64 for 127.0.0.1
    '198.18.0.1', // benchmarking range
    '192.0.0.1', // IETF protocol assignments
  ])('isPrivateAddress(%s) is true', (ip) => {
    expect(isPrivateAddress(ip)).toBe(true);
  });

  it.each(['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111', '::ffff:808:808', '64:ff9b::808:808'])(
    'isPrivateAddress(%s) is false (public)',
    (ip) => {
      expect(isPrivateAddress(ip)).toBe(false);
    },
  );

  it.each([
    'https://[::ffff:127.0.0.1]/hook',
    'https://[::ffff:10.0.0.1]/hook',
    'https://[0:0:0:0:0:ffff:7f00:1]/hook',
  ])('assertPublicUrl rejects %s in production', async (url) => {
    await expect(assertPublicUrl(url, true)).rejects.toThrow();
  });
});
