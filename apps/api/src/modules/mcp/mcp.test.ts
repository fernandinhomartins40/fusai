import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { prisma } from '@fuseai/db';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { startFakeAsaas } from '../../../test/fake-asaas';
import { startFakeLlm } from '../../../test/fake-llm';
import { ECHO_CHARGE, FAKE_PROVIDER_KEY, setupGateway } from '../../../test/gateway-fixtures';
import { createTestApp, resetDb } from '../../../test/helpers';
import { generateApiKey, hashApiKey, keyDisplayPrefix } from '../api-keys/keys';
import { issueSessionToken } from '../app-users/service';

type ToolResult = { content: { type: string; text: string }[]; isError?: boolean };

describe('MCP server (Phase 8)', () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let fake: Awaited<ReturnType<typeof startFakeLlm>>;
  let asaas: Awaited<ReturnType<typeof startFakeAsaas>>;
  let base: string;
  const hooks: string[] = [];
  let hookServer: ReturnType<typeof createServer>;
  let hookUrl: string;

  beforeAll(async () => {
    fake = await startFakeLlm(FAKE_PROVIDER_KEY);
    asaas = await startFakeAsaas();
    ctx = await createTestApp({ env: { ASAAS_API_URL: asaas.baseUrl } });
    await ctx.app.listen({ port: 0, host: '127.0.0.1' });
    base = `http://127.0.0.1:${(ctx.app.server.address() as AddressInfo).port}`;
    hookServer = createServer((req, res) => {
      hooks.push(String(req.headers['x-fuse-event']));
      res.writeHead(200).end();
    });
    await new Promise<void>((r) => hookServer.listen(0, '127.0.0.1', r));
    hookUrl = `http://127.0.0.1:${(hookServer.address() as AddressInfo).port}/hook`;
  });
  afterAll(async () => {
    await ctx.app.close();
    await fake.close();
    await asaas.close();
    hookServer.close();
  });
  beforeEach(async () => {
    await resetDb();
    ctx.app.caches.invalidate();
    await ctx.redis.flushdb();
    hooks.length = 0;
  });

  async function connect(key: string) {
    const client = new Client({ name: 'vitest', version: '1.0.0' });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
        requestInit: { headers: { authorization: `Bearer ${key}` } },
      }),
    );
    return client;
  }
  const call = async (client: Client, name: string, args: Record<string, unknown> = {}) =>
    (await client.callTool({ name, arguments: args })) as ToolResult;
  const textOf = (r: ToolResult) => r.content[0]?.text ?? '';
  const jsonOf = (r: ToolResult) => JSON.parse(textOf(r));

  async function setup(opts: Parameters<typeof setupGateway>[2] = {}) {
    const g = await setupGateway(ctx.env, fake.baseUrl, { balanceMicros: 5_000_000n, ...opts });
    await prisma.creditPackage.create({
      data: {
        projectId: g.project.id,
        name: '100 mensagens',
        priceCents: 990,
        creditMicros: 9_000_000n,
        bonusMicros: 1_000_000n,
      },
    });
    return g;
  }

  it('lists every tool, resource and prompt of PRD §10.1', async () => {
    const g = await setup();
    const client = await connect(g.plain);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(
      [
        'create_package',
        'create_test_checkout',
        'get_balance',
        'get_integration_guide',
        'get_project_config',
        'get_usage',
        'list_models',
        'list_packages',
        'send_test_webhook',
        'test_chat',
        'update_project_settings',
      ].sort(),
    );
    expect(tools.find((t) => t.name === 'list_models')?.annotations?.readOnlyHint).toBe(true);
    const { resources } = await client.listResources();
    expect(resources.map((r) => r.uri).sort()).toEqual([
      'fuseai://docs/api',
      'fuseai://docs/checkout',
      'fuseai://docs/sdk',
      'fuseai://project',
    ]);
    const { prompts } = await client.listPrompts();
    expect(prompts.map((p) => p.name).sort()).toEqual([
      'integrar_chat',
      'integrar_compra_pix',
      'migrar_de_openai',
    ]);
    expect(client.getInstructions()).toContain('"App"');
    await client.close();
  });

  it('rejects missing keys, session tokens and keys without the mcp scope', async () => {
    const g = await setup();
    const res = await fetch(`${base}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toContain('Bearer');

    const user = await prisma.appUser.create({
      data: { projectId: g.project.id, externalId: 'u' },
    });
    const { token } = issueSessionToken(user.id, g.project.id, ctx.env.SESSION_TOKEN_SECRET);
    await expect(connect(token)).rejects.toThrow();

    const plain = generateApiKey('LIVE');
    await prisma.apiKey.create({
      data: {
        projectId: g.project.id,
        name: 'sem mcp',
        env: 'LIVE',
        prefix: keyDisplayPrefix(plain),
        hash: hashApiKey(plain, ctx.env.KEY_PEPPER),
        scopes: ['chat'],
        createdById: 'test',
      },
    });
    const noScope = await fetch(`${base}/mcp`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${plain}`,
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    expect(noScope.status).toBe(403);
    expect((await fetch(`${base}/mcp`)).status).toBe(405);
  });

  it('get_integration_guide is personalized for the project and the stack', async () => {
    const g = await setup();
    await prisma.project.update({
      where: { id: g.project.id },
      data: { billingMode: 'END_USER_WALLET' },
    });
    const client = await connect(g.plain);
    const guide = textOf(await call(client, 'get_integration_guide', { stack: 'react-native' }));
    expect(guide).toContain('# Integração FuseAI — App');
    expect(guide).toContain(`\`${ctx.env.API_URL}/v1\``);
    expect(guide).toContain('Cobrar do usuário final');
    expect(guide).toContain('`fuse/echo`');
    expect(guide).toContain('**100 mensagens**, R$ 9,90');
    expect(guide).toContain('expo-web-browser');
    expect(guide).not.toContain(g.plain);

    const project = await client.readResource({ uri: 'fuseai://project' });
    expect((project.contents[0] as { text: string }).text).toContain('# FUSEAI.md');
    // Same content as the dashboard download (Kit de Integração).
    const md = await ctx.app.inject({
      method: 'GET',
      url: `/internal/projects/${g.project.id}/fuseai-md`,
    });
    expect(md.statusCode).toBe(401); // dashboard route: needs a session cookie
    const prompt = await client.getPrompt({
      name: 'integrar_chat',
      arguments: { stack: 'nextjs' },
    });
    expect(JSON.stringify(prompt.messages)).toContain('get_integration_guide');
    await client.close();
  });

  it('test_chat goes through the real gateway and is charged; balance and usage reflect it', async () => {
    const g = await setup();
    const client = await connect(g.plain);
    const res = jsonOf(await call(client, 'test_chat', { model: 'fuse/echo' }));
    expect(res.answer).toBe('Olá do FuseAI!');
    const balance = jsonOf(await call(client, 'get_balance'));
    expect(balance.balance_micros).toBe(String(5_000_000n - ECHO_CHARGE));
    const usage = jsonOf(await call(client, 'get_usage'));
    expect(usage.total.requests).toBe(1);
    const models = jsonOf(await call(client, 'list_models'));
    expect(models.map((m: { id: string }) => m.id)).toContain('fuse/echo');
    // Every call is audited.
    expect(await prisma.auditLog.count({ where: { action: { startsWith: 'mcp.' } } })).toBe(4);
    await client.close();
  });

  it('update_project_settings previews, then applies only with confirm', async () => {
    const g = await setup();
    const client = await connect(g.plain);
    const args = {
      allowedOrigins: ['https://app.exemplo.com'],
      webhookUrl: hookUrl,
      billingMode: 'HYBRID',
    };
    const preview = jsonOf(await call(client, 'update_project_settings', args));
    expect(preview.aplicado).toBe(false);
    expect(
      (await prisma.project.findUniqueOrThrow({ where: { id: g.project.id } })).billingMode,
    ).toBe('ORG_WALLET');

    const applied = jsonOf(
      await call(client, 'update_project_settings', { ...args, confirm: true }),
    );
    expect(applied.aplicado).toBe(true);
    const p = await prisma.project.findUniqueOrThrow({ where: { id: g.project.id } });
    expect(p).toMatchObject({
      billingMode: 'HYBRID',
      allowedOrigins: ['https://app.exemplo.com'],
      webhookUrl: hookUrl,
    });
    expect(p.webhookSecret).not.toBeNull();

    const bad = await call(client, 'update_project_settings', {
      allowedOrigins: ['https://x.com/path'],
      confirm: true,
    });
    expect(bad.isError).toBe(true);

    const sent = jsonOf(await call(client, 'send_test_webhook'));
    expect(sent).toMatchObject({ status: 'delivered', responseStatus: 200 });
    expect(hooks).toEqual(['test.ping']);
    await client.close();
  });

  it('create_package validates; create_test_checkout only with a test key in sandbox', async () => {
    const g = await setup();
    await prisma.project.update({
      where: { id: g.project.id },
      data: { billingMode: 'END_USER_WALLET' },
    });
    const live = await connect(g.plain);
    const pkg = jsonOf(
      await call(live, 'create_package', {
        name: 'Grande',
        price_brl: '49.90',
        credits_brl: '45',
        bonus_brl: '5',
      }),
    );
    expect(pkg).toMatchObject({
      priceCents: 4990,
      creditMicros: '45000000',
      bonusMicros: '5000000',
    });
    expect(
      (await call(live, 'create_package', { name: 'Barato', price_brl: '1.00', credits_brl: '1' }))
        .isError,
    ).toBe(true);
    expect((await call(live, 'list_packages')).content[0]?.text).toContain('Grande');
    const refused = await call(live, 'create_test_checkout');
    expect(refused.isError).toBe(true);
    expect(textOf(refused)).toContain('fai_test_');
    await live.close();

    const plain = generateApiKey('TEST');
    await prisma.apiKey.create({
      data: {
        projectId: g.project.id,
        name: 'teste',
        env: 'TEST',
        prefix: keyDisplayPrefix(plain),
        hash: hashApiKey(plain, ctx.env.KEY_PEPPER),
        scopes: ['mcp'],
        createdById: 'test',
      },
    });
    const test = await connect(plain);
    const checkout = jsonOf(await call(test, 'create_test_checkout', { externalId: 'dev-1' }));
    expect(checkout).toMatchObject({ status: 'PENDING', amountCents: 990 });
    expect(checkout.hostedUrl).toContain('/pay/chk_');
    await test.close();
  });
});
