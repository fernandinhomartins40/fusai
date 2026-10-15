import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { signPayload } from '../modules/webhooks-out/service';
import { signJwt, verifyJwt } from './jwt';
import { isPrivateAddress } from './ssrf';

describe('session JWT', () => {
  const secret = 'session-secret-1234567890';
  const exp = Math.floor(Date.now() / 1000) + 60;

  it('round-trips and checks expiration', () => {
    const token = signJwt({ sub: 'u1', exp }, secret);
    expect(verifyJwt<{ sub: string; exp: number }>(token, secret)?.sub).toBe('u1');
    expect(verifyJwt(token, secret, (exp + 1) * 1000)).toBeNull();
    expect(verifyJwt(signJwt({ sub: 'u1' }, secret), secret)).toBeNull(); // no exp
  });

  it('rejects other secrets, tampering and alg=none', () => {
    const token = signJwt({ sub: 'u1', exp }, secret);
    expect(verifyJwt(token, 'other-secret-1234567890')).toBeNull();
    const [h, , s] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ sub: 'admin', exp })).toString('base64url');
    expect(verifyJwt(`${h}.${forged}.${s}`, secret)).toBeNull();
    const none = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    expect(verifyJwt(`${none}.${forged}.`, secret)).toBeNull();
    expect(verifyJwt('garbage', secret)).toBeNull();
  });
});

describe('webhook signature', () => {
  it('signs t + "." + body with HMAC-SHA256', () => {
    const sig = signPayload('whsec_x', '{"a":1}', 1700000000);
    const expected = createHmac('sha256', 'whsec_x').update('1700000000.{"a":1}').digest('hex');
    expect(sig).toBe(`t=1700000000,v1=${expected}`);
  });
});

describe('SSRF guard', () => {
  it('flags private, loopback and link-local addresses', () => {
    for (const ip of [
      '10.0.0.1',
      '127.0.0.1',
      '192.168.1.5',
      '172.20.0.1',
      '169.254.169.254',
      '::1',
      'fd00::1',
      '::ffff:10.1.1.1',
      '100.64.0.1',
    ]) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
    for (const ip of ['8.8.8.8', '172.32.0.1', '2606:4700::1111'])
      expect(isPrivateAddress(ip), ip).toBe(false);
  });
});
