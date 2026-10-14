import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../app';
import { testEnv } from '../../lib/env';
import { createMemoryMailer } from '../../lib/mailer';

describe('GET /health', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => {
    app = await buildApp(testEnv(), { mailer: createMemoryMailer() });
    app.post('/__echo', async (req) => ({ body: req.body ?? null }));
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns ok with a request id', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'ok', service: 'fuseai-api' });
    expect(res.headers['x-request-id']).toBeTruthy();
  });

  it('accepts empty JSON bodies and rejects malformed or poisoned JSON', async () => {
    const json = { 'content-type': 'application/json' };
    const empty = await app.inject({ method: 'POST', url: '/__echo', headers: json, payload: '' });
    expect(empty.json()).toEqual({ body: null });
    const bad = await app.inject({ method: 'POST', url: '/__echo', headers: json, payload: '{x' });
    expect(bad.statusCode).toBe(400);
    const poisoned = await app.inject({
      method: 'POST',
      url: '/__echo',
      headers: json,
      payload: '{"__proto__":{"admin":true}}',
    });
    expect(poisoned.statusCode).toBe(400);
  });

  it('propagates an incoming request id', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { 'x-request-id': 'req-123' },
    });
    expect(res.headers['x-request-id']).toBe('req-123');
  });
});

describe('CORS for the dashboard', () => {
  it('lets the web app preflight every method it uses', async () => {
    const app = await buildApp(testEnv({ APP_URL: 'http://localhost:3000' }), {
      mailer: createMemoryMailer(),
    });
    for (const method of ['PUT', 'PATCH', 'DELETE']) {
      const res = await app.inject({
        method: 'OPTIONS',
        url: '/internal/projects/x',
        headers: {
          origin: 'http://localhost:3000',
          'access-control-request-method': method,
          'access-control-request-headers': 'content-type',
        },
      });
      expect(res.statusCode).toBe(204);
      expect(String(res.headers['access-control-allow-methods'])).toContain(method);
      expect(res.headers['access-control-allow-credentials']).toBe('true');
    }
    const foreign = await app.inject({
      method: 'OPTIONS',
      url: '/internal/projects/x',
      headers: { origin: 'https://evil.example', 'access-control-request-method': 'PATCH' },
    });
    expect(foreign.headers['access-control-allow-origin']).toBeUndefined();
    await app.close();
  });
});
