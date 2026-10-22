import type { FastifyRequest } from 'fastify';
import { describe, expect, it } from 'vitest';
import { serializeReq } from './logger';

const req = (url: string, route?: string) =>
  ({
    method: 'GET',
    url,
    host: 'api.fusai.com.br',
    ip: '127.0.0.1',
    routeOptions: route ? { url: route } : {},
  }) as unknown as FastifyRequest;

describe('serializeReq (PIE S-06)', () => {
  it('logs the route pattern instead of tokens in the path or query', () => {
    const out = serializeReq(
      req('/internal/invitations/abc123secret?x=1', '/internal/invitations/:token'),
    );
    expect(out.url).toBe('/internal/invitations/:token');
  });

  it('without a route (404), drops the query and masks long segments', () => {
    const out = serializeReq(
      req('/api/auth/reset-password/AbCdEfGhIjKlMnOpQrStUvWxYz?token=secret'),
    );
    expect(out.url).toBe('/api/auth/reset-password/:id');
    expect(JSON.stringify(out)).not.toContain('secret');
  });
});
