import type { AddressInfo } from 'node:net';
import { prisma } from '@fusai/db';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { startFakeLlm } from '../../../test/fake-llm';
import { FAKE_PROVIDER_KEY, setupGateway } from '../../../test/gateway-fixtures';
import { createTestApp, resetDb } from '../../../test/helpers';

/**
 * PIE audit — negative tests (Motor C). Uses the shared test database: run only when no other
 * suite is using it:  pnpm --filter @fusai/api test -- src/modules/mcp/pie-security.test.ts
 * They describe the SECURE behavior and are expected to FAIL until the findings are fixed.
 */
type ToolResult = { content: { type: string; text: string }[]; isError?: boolean };

describe('PIE S-01: project API key (scope mcp) must not change privileged project settings', () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let fake: Awaited<ReturnType<typeof startFakeLlm>>;
  let base: string;

  beforeAll(async () => {
    fake = await startFakeLlm(FAKE_PROVIDER_KEY);
    ctx = await createTestApp();
    await ctx.app.listen({ port: 0, host: '127.0.0.1' });
    base = `http://127.0.0.1:${(ctx.app.server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    await ctx.app.close();
    await fake.close();
  });
  beforeEach(async () => {
    await resetDb();
    ctx.app.caches.invalidate();
    await ctx.redis.flushdb();
  });

  async function connect(key: string) {
    const client = new Client({ name: 'pie', version: '1.0.0' });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
        requestInit: { headers: { authorization: `Bearer ${key}` } },
      }),
    );
    return client;
  }

  it('a key created by a DEVELOPER cannot switch billingMode (dashboard requires OWNER/ADMIN)', async () => {
    const g = await setupGateway(ctx.env, fake.baseUrl, { keyCreatorRole: 'DEVELOPER' });
    const client = await connect(g.plain);
    const r = (await client.callTool({
      name: 'update_project_settings',
      arguments: { billingMode: 'END_USER_WALLET', confirm: true },
    })) as ToolResult;
    const project = await prisma.project.findUniqueOrThrow({ where: { id: g.project.id } });
    // Secure behavior: refused, billing mode unchanged.
    expect(r.isError).toBe(true);
    expect(project.billingMode).toBe('ORG_WALLET');
    await client.close();
  });

  it('a key whose creator left the organization cannot redirect outbound webhooks', async () => {
    // Default fixture: the creator has no membership (e.g. a removed member).
    const g = await setupGateway(ctx.env, fake.baseUrl);
    const client = await connect(g.plain);
    const r = (await client.callTool({
      name: 'update_project_settings',
      arguments: { webhookUrl: 'https://attacker.example/hook', confirm: true },
    })) as ToolResult;
    const project = await prisma.project.findUniqueOrThrow({ where: { id: g.project.id } });
    expect(r.isError).toBe(true);
    expect(project.webhookUrl).toBeNull();
    await client.close();
  });

  it('a key whose creator left the organization cannot change allowed origins', async () => {
    const g = await setupGateway(ctx.env, fake.baseUrl);
    const client = await connect(g.plain);
    const r = (await client.callTool({
      name: 'update_project_settings',
      arguments: { allowedOrigins: ['https://attacker.example'], confirm: true },
    })) as ToolResult;
    const project = await prisma.project.findUniqueOrThrow({ where: { id: g.project.id } });
    expect(r.isError).toBe(true);
    expect(project.allowedOrigins).toEqual([]);
    await client.close();
  });

  it('a key created by a BILLING member cannot change any project setting (dashboard requires editors)', async () => {
    const g = await setupGateway(ctx.env, fake.baseUrl, { keyCreatorRole: 'BILLING' });
    const client = await connect(g.plain);
    for (const args of [
      { allowedOrigins: ['https://attacker.example'] },
      { webhookUrl: 'https://attacker.example/hook' },
    ]) {
      const r = (await client.callTool({
        name: 'update_project_settings',
        arguments: { ...args, confirm: true },
      })) as ToolResult;
      expect(r.isError).toBe(true);
    }
    const project = await prisma.project.findUniqueOrThrow({ where: { id: g.project.id } });
    expect(project.allowedOrigins).toEqual([]);
    expect(project.webhookUrl).toBeNull();
    await client.close();
  });

  it('a DEVELOPER key still changes allowed origins (same as the dashboard)', async () => {
    const g = await setupGateway(ctx.env, fake.baseUrl, { keyCreatorRole: 'DEVELOPER' });
    const client = await connect(g.plain);
    const r = (await client.callTool({
      name: 'update_project_settings',
      arguments: { allowedOrigins: ['https://app.exemplo.com'], confirm: true },
    })) as ToolResult;
    expect(r.isError).toBeFalsy();
    const project = await prisma.project.findUniqueOrThrow({ where: { id: g.project.id } });
    expect(project.allowedOrigins).toEqual(['https://app.exemplo.com']);
    await client.close();
  });
});
