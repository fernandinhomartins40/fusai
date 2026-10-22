import { afterAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../app';
import { testEnv } from '../../lib/env';
import { createMemoryJobQueue } from '../../lib/jobs';
import { createMemoryMailer } from '../../lib/mailer';
import { createRedis } from '../../lib/redis';

describe('GET /health/ready (PIE V-05)', () => {
  const env = testEnv();
  const redis = createRedis(env.REDIS_URL, 'test:ready:');
  redis.on('error', () => {}); // cut on purpose in the second test
  const deps = { mailer: createMemoryMailer(), redis, jobs: createMemoryJobQueue() };
  let app: Awaited<ReturnType<typeof buildApp>>;

  afterAll(async () => {
    await app?.close();
  });

  it('reports Postgres and Redis as ready', async () => {
    app = await buildApp(env, deps);
    const res = await app.inject({ method: 'GET', url: '/health/ready' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      status: 'ok',
      service: 'fuseai-api',
      database: 'ok',
      redis: 'ok',
    });
  });

  it('answers 503 when Redis is down instead of hanging', async () => {
    redis.disconnect();
    const res = await app.inject({ method: 'GET', url: '/health/ready' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ status: 'unavailable', database: 'ok', redis: 'error' });
  });
});
