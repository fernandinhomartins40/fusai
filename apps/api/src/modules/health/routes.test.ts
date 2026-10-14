import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../app';
import { testEnv } from '../../lib/env';
import { createMemoryMailer } from '../../lib/mailer';

describe('GET /health', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => {
    app = await buildApp(testEnv(), { mailer: createMemoryMailer() });
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

  it('propagates an incoming request id', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { 'x-request-id': 'req-123' },
    });
    expect(res.headers['x-request-id']).toBe('req-123');
  });
});
