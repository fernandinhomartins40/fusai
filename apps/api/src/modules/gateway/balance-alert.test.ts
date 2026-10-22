import type { AddressInfo } from 'node:net';
import { prisma } from '@fusai/db';
import OpenAI from 'openai';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { startFakeLlm } from '../../../test/fake-llm';
import { ECHO_CHARGE, FAKE_PROVIDER_KEY, setupGateway } from '../../../test/gateway-fixtures';
import { createTestApp, resetDb } from '../../../test/helpers';

const messages = [{ role: 'user' as const, content: 'Diga olá' }];

describe('low balance e-mail (O-06)', () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let fake: Awaited<ReturnType<typeof startFakeLlm>>;
  let baseURL: string;

  beforeAll(async () => {
    fake = await startFakeLlm(FAKE_PROVIDER_KEY);
    ctx = await createTestApp();
    await ctx.app.listen({ port: 0, host: '127.0.0.1' });
    baseURL = `http://127.0.0.1:${(ctx.app.server.address() as AddressInfo).port}/v1`;
  });
  afterAll(async () => {
    await ctx.app.close();
    await fake.close();
  });
  beforeEach(async () => {
    await resetDb();
    ctx.app.caches.invalidate();
    await ctx.redis.flushdb();
    ctx.mailer.sent.length = 0;
  });

  async function setup(balanceMicros: bigint) {
    const g = await setupGateway(ctx.env, fake.baseUrl, { balanceMicros, keyCreatorRole: 'OWNER' });
    for (const role of ['BILLING', 'DEVELOPER'] as const) {
      const user = await prisma.user.create({
        data: { id: `${role}-${g.org.id}`, name: role, email: `${role.toLowerCase()}@teste.local` },
      });
      await prisma.membership.create({ data: { userId: user.id, orgId: g.org.id, role } });
    }
    return g;
  }
  const chat = (key: string) =>
    new OpenAI({ apiKey: key, baseURL, maxRetries: 0 }).chat.completions.create({
      model: 'fuse/echo',
      messages,
    });
  const recipients = () => ctx.mailer.sent.map((e) => e.to).sort();

  it('e-mails owners and billing once a day when the wallet crosses the alert threshold', async () => {
    const g = await setup(5_000_000n + ECHO_CHARGE - 1n); // below R$ 5,00 after one call
    await chat(g.plain);
    await vi.waitFor(() => expect(ctx.mailer.sent).toHaveLength(2));
    expect(recipients()).toEqual([`billing@teste.local`, `creator-${g.org.id}@teste.local`]);
    const email = ctx.mailer.sent[0];
    expect(email?.subject).toContain('Saldo baixo');
    expect(email?.text).toContain('http://localhost:3000/app/carteira?recarga=1');

    await chat(g.plain);
    await new Promise((r) => setTimeout(r, 200));
    expect(ctx.mailer.sent).toHaveLength(2); // still once a day
  });

  it('sends a "credits ran out" e-mail once when requests start failing with 402', async () => {
    const g = await setup(ECHO_CHARGE); // less than the hold: the call is refused
    await expect(chat(g.plain)).rejects.toMatchObject({ status: 402 });
    await vi.waitFor(() => expect(ctx.mailer.sent).toHaveLength(2));
    expect(ctx.mailer.sent.map((e) => e.subject)).toEqual([
      'Créditos esgotados em Org Teste',
      'Créditos esgotados em Org Teste',
    ]);

    await expect(chat(g.plain)).rejects.toMatchObject({ status: 402 });
    await new Promise((r) => setTimeout(r, 200));
    expect(ctx.mailer.sent).toHaveLength(2);
  });

  it('does not e-mail while the balance is above the threshold', async () => {
    const g = await setup(50_000_000n);
    await chat(g.plain);
    await new Promise((r) => setTimeout(r, 200));
    expect(ctx.mailer.sent).toHaveLength(0);
  });
});
