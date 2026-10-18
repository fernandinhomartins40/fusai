import { describe, expect, it, vi } from 'vitest';
import { Fusai, FusaiError } from './client';
import { fusaiAccountHandler } from './server';

/** A Fusai client whose HTTP layer is a fake /v1 (no network). */
function fakeFusai() {
  const calls: { method: string; url: string; body?: unknown; idem?: string | null }[] = [];
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    calls.push({
      method: init?.method ?? 'GET',
      url,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
      idem: headers.get('idempotency-key'),
    });
    const json = (status: number, body: unknown) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      });
    if (url.endsWith('/balance'))
      return json(200, { object: 'balance', available_micros: '7000000' });
    if (url.includes('/usage')) return json(200, { object: 'usage', total: { requests: 3 } });
    if (url.endsWith('/topup-options'))
      return json(200, { object: 'topup_options', minAmountCents: 500 });
    if (url.endsWith('/topups') && init?.method === 'POST') {
      const body = JSON.parse(String(init.body));
      if (body.amountCents < 500)
        return json(400, {
          error: { message: 'A recarga mínima é R$ 5,00.', code: 'amount_too_low' },
        });
      return json(201, { object: 'topup', checkoutId: 'chk_1', status: 'PENDING' });
    }
    if (url.endsWith('/topups')) return json(200, { data: [{ checkoutId: 'chk_1' }] });
    if (url.endsWith('/topups/chk_1')) return json(200, { object: 'topup', status: 'RECEIVED' });
    return json(404, { error: { message: 'x', code: 'not_found' } });
  });
  const fuse = new Fusai({
    apiKey: 'fai_live_x',
    baseUrl: 'https://api.test/v1',
    fetch: fetchImpl as unknown as typeof fetch,
  });
  return { fuse, calls };
}

describe('fusaiAccountHandler (uso próprio)', () => {
  const req = (method: string, path: string, body?: object, headers: Record<string, string> = {}) =>
    new Request(`https://app.cliente.com.br/api/fusai${path}`, {
      method,
      headers: { 'content-type': 'application/json', ...headers },
      body: body ? JSON.stringify(body) : undefined,
    });

  it('refuses everyone that authorize rejects, without calling fusai', async () => {
    const { fuse, calls } = fakeFusai();
    const handler = fusaiAccountHandler(fuse, { authorize: () => false });
    for (const [m, p] of [
      ['GET', '/balance'],
      ['POST', '/topups'],
      ['GET', '/topups/chk_1'],
    ] as const) {
      expect(
        (await handler(req(m, p, m === 'POST' ? { amountCents: 5000 } : undefined))).status,
      ).toBe(401);
    }
    expect(calls).toHaveLength(0);
  });

  it('proxies balance, usage, options, top-ups and status', async () => {
    const { fuse, calls } = fakeFusai();
    const handler = fusaiAccountHandler(fuse, { authorize: async () => true });
    expect(await (await handler(req('GET', '/balance'))).json()).toMatchObject({
      available_micros: '7000000',
    });
    expect((await handler(req('GET', '/usage?from=2026-10-01T00:00:00Z'))).status).toBe(200);
    expect(calls.at(-1)?.url).toContain('/usage?from=2026-10-01T00%3A00%3A00.000Z');
    expect((await handler(req('GET', '/topup-options'))).status).toBe(200);

    const created = await handler(
      req('POST', '/topups', { amountCents: 5000 }, { 'idempotency-key': 'k-1' }),
    );
    expect(created.status).toBe(201);
    expect(calls.at(-1)).toMatchObject({ body: { amountCents: 5000 }, idem: 'k-1' });

    expect(await (await handler(req('GET', '/topups/chk_1'))).json()).toMatchObject({
      status: 'RECEIVED',
    });
    expect(await (await handler(req('GET', '/topups'))).json()).toMatchObject({
      data: [{ checkoutId: 'chk_1' }],
    });
    expect((await handler(req('DELETE', '/topups'))).status).toBe(404);
  });

  it('passes fusai errors through with their status and message', async () => {
    const { fuse } = fakeFusai();
    const handler = fusaiAccountHandler(fuse, { authorize: () => true });
    const res = await handler(req('POST', '/topups', { amountCents: 100 }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: { message: 'A recarga mínima é R$ 5,00.', code: 'amount_too_low' },
    });
    expect(FusaiError).toBeDefined();
  });
});
