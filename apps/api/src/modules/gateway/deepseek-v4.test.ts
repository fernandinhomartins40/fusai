import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { prisma } from '@fusai/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { startFakeLlm } from '../../../test/fake-llm';
import { FAKE_PROVIDER_KEY, setupGateway } from '../../../test/gateway-fixtures';
import { createTestApp, resetDb } from '../../../test/helpers';
import { encryptSecret, parseEncryptionKey } from '../../lib/crypto';

const MIGRATION = fileURLToPath(
  new URL(
    '../../../../../packages/db/prisma/migrations/20261023150000_deepseek_v4/migration.sql',
    import.meta.url,
  ),
);
const SEED_TEXT = 'Preço de exemplo — verificar na página oficial do provedor antes de ativar.';

/** The data part of the migration (the column already exists in the test database). */
async function runDataMigration() {
  const statements = readFileSync(MIGRATION, 'utf8')
    .split(/;\s*\n/)
    .map((s) =>
      s
        .split('\n')
        .filter((line) => !line.trim().startsWith('--'))
        .join('\n')
        .trim(),
    )
    .filter((s) => s && !s.startsWith('ALTER TABLE'));
  for (const sql of statements) await prisma.$executeRawUnsafe(sql);
}

describe('DeepSeek V4 models', () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let fake: Awaited<ReturnType<typeof startFakeLlm>>;

  beforeAll(async () => {
    fake = await startFakeLlm(FAKE_PROVIDER_KEY);
    ctx = await createTestApp();
  });
  afterAll(async () => {
    await ctx.app.close();
    await fake.close();
  });
  beforeEach(async () => {
    await resetDb();
    ctx.app.caches.invalidate();
    fake.requests.length = 0;
  });

  const chat = (token: string, body: object) =>
    ctx.app.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: { authorization: `Bearer ${token}` },
      payload: { model: 'fuse/echo', messages: [{ role: 'user', content: 'Oi' }], ...body },
    });

  it('sends the model upstream params (thinking off) over the client value, keeping the cap', async () => {
    const g = await setupGateway(ctx.env, fake.baseUrl);
    await prisma.model.update({
      where: { slug: 'fuse/echo' },
      data: { upstreamParams: { thinking: { type: 'disabled' } } },
    });
    ctx.app.caches.invalidate();

    const res = await chat(g.plain, { thinking: { type: 'enabled' }, max_tokens: 50 });
    expect(res.statusCode).toBe(200);
    const sent = fake.requests.at(-1)?.body ?? {};
    expect(sent.thinking).toEqual({ type: 'disabled' });
    expect(sent.max_tokens).toBe(50);
  });

  it('sends nothing extra for a model without upstream params', async () => {
    const g = await setupGateway(ctx.env, fake.baseUrl);
    await chat(g.plain, {});
    const sent = fake.requests.at(-1)?.body ?? {};
    expect(sent).not.toHaveProperty('thinking');
  });

  it('migration moves the slugs to deepseek-flash, adds V4 Pro, and the public list shows no cost', async () => {
    const apiKeyEnc = encryptSecret(FAKE_PROVIDER_KEY, parseEncryptionKey(ctx.env.ENCRYPTION_KEY));
    const provider = await prisma.provider.create({
      data: {
        slug: 'deepseek',
        name: 'DeepSeek',
        baseUrl: fake.baseUrl,
        apiKeyEnc,
        status: 'ACTIVE',
      },
    });
    const old = {
      providerId: provider.id,
      contextWindow: 128_000,
      inputCostUsdPerM: '0.27',
      outputCostUsdPerM: '1.10',
      description: SEED_TEXT,
      active: true,
    };
    await prisma.model.create({
      data: {
        ...old,
        slug: 'fuse/deepseek-chat',
        displayName: 'DeepSeek Chat',
        upstreamModel: 'deepseek-chat',
      },
    });
    await prisma.model.create({
      data: {
        ...old,
        slug: 'fuse/deepseek-reasoner',
        displayName: 'Meu nome',
        upstreamModel: 'deepseek-reasoner',
        description: 'Texto do admin',
      },
    });

    await runDataMigration();
    await runDataMigration(); // idempotent

    const chatModel = await prisma.model.findUniqueOrThrow({
      where: { slug: 'fuse/deepseek-chat' },
    });
    expect(chatModel).toMatchObject({
      upstreamModel: 'deepseek-flash',
      upstreamParams: { thinking: { type: 'disabled' } },
      displayName: 'DeepSeek V4.1 Flash',
      contextWindow: 1_000_000,
      maxOutputTokens: 8192,
      supportsReasoning: false,
      supportsVision: true,
    });
    expect(chatModel.inputCostUsdPerM.toString()).toBe('0.3');
    expect(chatModel.cachedInputCostUsdPerM?.toString()).toBe('0.006');
    expect(chatModel.outputCostUsdPerM.toString()).toBe('1.2');
    expect(chatModel.description).not.toBe(SEED_TEXT);

    const reasoner = await prisma.model.findUniqueOrThrow({
      where: { slug: 'fuse/deepseek-reasoner' },
    });
    expect(reasoner).toMatchObject({
      upstreamModel: 'deepseek-flash',
      upstreamParams: null,
      supportsReasoning: true,
      maxOutputTokens: 32_768,
      // What the admin customized stays.
      displayName: 'Meu nome',
      description: 'Texto do admin',
    });

    const pro = await prisma.model.findMany({ where: { slug: 'fuse/deepseek-v4-pro' } });
    expect(pro).toHaveLength(1);
    expect(pro[0]).toMatchObject({
      upstreamModel: 'deepseek-v4-pro',
      active: true,
      priceMode: 'AUTO',
    });
    expect(pro[0]?.outputCostUsdPerM.toString()).toBe('3.96');

    ctx.app.caches.invalidate();
    const res = await ctx.app.inject({ method: 'GET', url: '/public/models' });
    expect(res.statusCode).toBe(200);
    const { data } = res.json() as { data: { id: string; description: string }[] };
    expect(data.map((m) => m.id).sort()).toEqual([
      'fuse/deepseek-chat',
      'fuse/deepseek-reasoner',
      'fuse/deepseek-v4-pro',
    ]);
    expect(data.every((m) => !m.description.includes('Preço'))).toBe(true);
    const raw = res.body.toLowerCase();
    for (const leak of [
      'cost',
      'markup',
      'upstream',
      'thinking',
      'deepseek-flash',
      '"1.2"',
      '3.96',
    ]) {
      expect(raw).not.toContain(leak);
    }
  });
});
