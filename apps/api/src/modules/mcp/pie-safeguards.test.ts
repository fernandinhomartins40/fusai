import type { AddressInfo } from 'node:net';
import { prisma } from '@fusai/db';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { APP_URL, createTestApp, createUserSession, resetDb } from '../../../test/helpers';

type ToolResult = { content: { type: string; text: string }[]; isError?: boolean };

/** PIE S-03: what an AI can do with an organization agent key is narrowed and reported. */
describe('PIE S-03: MCP safeguards', () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let base: string;
  let owner: string;
  let orgId: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    await ctx.app.listen({ port: 0, host: '127.0.0.1' });
    base = `http://127.0.0.1:${(ctx.app.server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    await ctx.app.close();
  });
  beforeEach(async () => {
    await resetDb();
    ctx.app.caches.invalidate();
    ctx.mailer.sent.length = 0;
    owner = await createUserSession(ctx.app, 'dono@example.com');
    const org = await ctx.app.inject({
      method: 'POST',
      url: '/internal/onboarding/organization',
      headers: { cookie: owner, origin: APP_URL },
      payload: { name: 'Agência Exemplo', document: '52998224725', phone: '11999990000' },
    });
    orgId = org.json().id;
  });

  async function connect() {
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/internal/organizations/${orgId}/agent-keys`,
      headers: { cookie: owner, origin: APP_URL },
      payload: { name: 'Claude Code' },
    });
    const client = new Client({ name: 'vitest', version: '1.0.0' });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
        requestInit: { headers: { authorization: `Bearer ${res.json().key}` } },
      }),
    );
    return client;
  }
  const call = async (client: Client, name: string, args: Record<string, unknown> = {}) =>
    (await client.callTool({ name, arguments: args })) as ToolResult;
  const jsonOf = (r: ToolResult) => JSON.parse(r.content[0]?.text ?? '{}');

  it('creates keys with the minimum scopes, never `mcp`, whatever the AI asks', async () => {
    const client = await connect();
    const own = jsonOf(
      await call(client, 'create_project', { name: 'Uso próprio', use_case: 'uso_proprio' }),
    );
    const resale = jsonOf(
      await call(client, 'create_project', { name: 'Revenda', use_case: 'revenda' }),
    );
    const ownKey = jsonOf(
      await call(client, 'create_api_key', {
        project: own.id,
        name: 'Servidor',
        scopes: ['mcp', 'chat'], // no longer part of the tool: ignored
      }),
    );
    const resaleKey = jsonOf(
      await call(client, 'create_api_key', { project: resale.id, name: 'Api' }),
    );
    const stored = await prisma.apiKey.findMany({ orderBy: { createdAt: 'asc' } });
    expect(stored.map((k) => k.id)).toEqual([ownKey.id, resaleKey.id]);
    expect(stored[0]?.scopes.sort()).toEqual(['billing:read', 'chat', 'checkout']);
    expect(stored[1]?.scopes.sort()).toEqual(['app_users', 'billing:read', 'chat', 'checkout']);
    expect(stored.every((k) => !k.scopes.includes('mcp'))).toBe(true);

    // The key cannot reach the project MCP.
    const mcp = await fetch(`${base}/mcp`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${ownKey.key}`,
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    expect(mcp.status).toBe(403);
    await client.close();
  });

  it('emails the owners when an AI changes webhook, origins or billing mode', async () => {
    const client = await connect();
    const project = jsonOf(
      await call(client, 'create_project', { name: 'Loja', use_case: 'revenda' }),
    );
    const id = project.id;

    // Preview (no confirm) and non-watched fields send nothing.
    await call(client, 'update_project_settings', {
      project: id,
      webhookUrl: 'https://cliente.example.com/hook',
    });
    await call(client, 'update_project_settings', {
      project: id,
      free_credit_brl: '0.00',
      confirm: true,
    });
    const mcpMails = () => ctx.mailer.sent.filter((m) => m.subject.includes('(MCP)'));
    expect(mcpMails()).toHaveLength(0);

    await call(client, 'update_project_settings', {
      project: id,
      webhookUrl: 'https://cliente.example.com/hook',
      allowedOrigins: ['https://app.cliente.example.com'],
      confirm: true,
    });
    expect(mcpMails()).toHaveLength(1);
    const mail = mcpMails()[0];
    expect(mail?.to).toBe('dono@example.com');
    expect(mail?.text).toContain('URL do webhook');
    expect(mail?.text).toContain('origens permitidas');
    // Only field names: no URL, origin or secret in the email.
    expect(mail?.text).not.toContain('cliente.example.com/hook');
    await client.close();
  });
});
