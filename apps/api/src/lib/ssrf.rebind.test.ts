import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { postPublic } from './ssrf';

/** PIE S-02: the socket re-checks DNS, so a host cannot rebind to a private IP after the check. */
describe('PIE S-02: DNS rebinding', () => {
  let hits = 0;
  const server = createServer((_req, res) => {
    hits++;
    res.end('ok');
  });
  let port = 0;
  beforeAll(async () => {
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    port = (server.address() as AddressInfo).port;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  const post = (guard: boolean, address: string) =>
    postPublic(`http://hooks.example.com:${port}/`, {
      headers: {},
      body: '{}',
      timeoutMs: 2_000,
      guard,
      // The name now resolves to a private address (it was public when assertPublicUrl ran).
      resolve: (_host, _opts, cb) => cb(null, [{ address, family: 4 }]),
    });

  it('blocks the connection when the name resolves to a private address', async () => {
    await expect(post(true, '127.0.0.1')).rejects.toThrow('Endereço não permitido');
    expect(hits).toBe(0);
  });

  it('connects normally without the guard (dev/test)', async () => {
    const status = await postPublic(`http://127.0.0.1:${port}/`, {
      headers: {},
      body: '{}',
      timeoutMs: 2_000,
      guard: false,
    });
    expect(status).toBe(200);
    expect(hits).toBe(1);
  });
});
