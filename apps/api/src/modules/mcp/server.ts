import { randomBytes } from 'node:crypto';
import type { PrismaClient } from '@fusai/db';
import { type DocUrls, docBundle, fusaiMd, GUIDE_STACKS, integrationGuide } from '@fusai/docs';
import { brlToMicros, microsToBrl, projectPackageSchema, projectUpdateSchema } from '@fusai/shared';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { encryptSecret } from '../../lib/crypto';
import type { Env } from '../../lib/env';
import { HttpError } from '../../lib/errors';
import type { SettingsStore } from '../../lib/settings';
import type { PaymentProvider } from '../../payments/types';
import { upsertAppUser } from '../app-users/service';
import type { GatewayContext } from '../gateway/auth';
import type { CatalogStore } from '../gateway/catalog';
import { serializeCheckout } from '../gateway/end-users';
import { listModelsFor, usageSummary } from '../gateway/queries';
import { projectSnapshot } from '../integration/snapshot';
import { createAppUserCheckout } from '../payments/service';
import { deliverWebhook, emitEvent } from '../webhooks-out/service';

export type McpDeps = {
  prisma: PrismaClient;
  catalog: CatalogStore;
  settings: SettingsStore;
  provider: PaymentProvider;
  env: Env;
  encryptionKey: Buffer;
  /** Runs a request against our own /v1 (test_chat goes through the real gateway and billing). */
  inject: (opts: {
    method: 'POST';
    url: string;
    headers: Record<string, string>;
    payload: Record<string, unknown>;
  }) => Promise<{ statusCode: number; headers: Record<string, unknown>; json: () => unknown }>;
  /** The caller's `Authorization` header, reused by test_chat. */
  authorization: string;
  ip: string;
};

/** Sandbox CPF used by create_test_checkout (valid check digits, not a real person's data). */
const SANDBOX_CPF = '52998224725';
const json = (value: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }],
});
const text = (value: string) => ({ content: [{ type: 'text' as const, text: value }] });
const fail = (message: string) => ({
  content: [{ type: 'text' as const, text: message }],
  isError: true,
});

/**
 * One MCP server per request (stateless Streamable HTTP, PRD §10.1), bound to the project of the
 * calling API key. Every tool call is written to the audit log.
 */
export function buildMcpServer(ctx: GatewayContext, deps: McpDeps) {
  const { prisma, catalog, settings, env } = deps;
  const urls: DocUrls = { api: env.API_URL, app: env.APP_URL };
  const project = () => prisma.project.findUniqueOrThrow({ where: { id: ctx.project.id } });
  const snapshot = async () => projectSnapshot(prisma, catalog, settings, await project(), ctx.org);

  const audit = (tool: string, metadata: Record<string, unknown> = {}) =>
    prisma.auditLog.create({
      data: {
        actorId: null,
        action: `mcp.${tool}`,
        target: ctx.project.id,
        metadata: { apiKeyId: ctx.key?.id ?? null, orgId: ctx.org.id, ...metadata },
        ip: deps.ip,
      },
    });

  /** Wraps a tool: audit + friendly errors (HttpError messages are already pt-BR). */
  function tool<A>(name: string, run: (args: A) => Promise<ReturnType<typeof json>>) {
    return async (args: A) => {
      await audit(name);
      try {
        return await run(args);
      } catch (err) {
        if (err instanceof HttpError) return fail(err.message);
        throw err;
      }
    };
  }

  const server = new McpServer(
    { name: 'fusai', title: 'fusai', version: '1.0.0' },
    {
      instructions: `fusai: gateway de IA compatível com OpenAI, cobrança em reais e Pix. Esta conexão está ligada ao projeto "${ctx.project.name}". Comece por get_integration_guide (informe a stack do app). Nunca coloque a chave secreta no front-end: use session tokens.`,
    },
  );

  // ---- Tools ----
  server.registerTool(
    'get_integration_guide',
    {
      title: 'Guia de integração do projeto',
      description:
        'Guia em Markdown personalizado para este projeto: base URL, modo de cobrança, modelos, pacotes, regras de segurança, código e checklist. Use primeiro.',
      inputSchema: {
        stack: z
          .enum(GUIDE_STACKS)
          .optional()
          .describe('Stack do app: nextjs, react-native, flutter, node, python ou laravel'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    tool<{ stack?: (typeof GUIDE_STACKS)[number] }>('get_integration_guide', async ({ stack }) =>
      text(integrationGuide(await snapshot(), urls, stack)),
    ),
  );

  server.registerTool(
    'get_project_config',
    {
      title: 'Configuração do projeto',
      description: 'Modo de cobrança, origens permitidas, webhook, pacotes, modelo padrão e URLs.',
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    tool('get_project_config', async () => {
      const p = await project();
      const snap = await snapshot();
      return json({
        project: { id: p.id, name: p.name, slug: p.slug },
        baseUrl: `${env.API_URL}/v1`,
        billingMode: p.billingMode,
        allowedOrigins: p.allowedOrigins,
        webhookUrl: p.webhookUrl,
        hasWebhookSecret: !!p.webhookSecret,
        freeCreditMicros: p.freeCreditMicros.toString(),
        defaultModel: snap.defaultModel,
        packages: snap.packages,
        keyEnv: ctx.env,
      });
    }),
  );

  server.registerTool(
    'list_models',
    {
      title: 'Modelos e preços',
      description: 'Modelos liberados para este projeto, capacidades e preços em R$ por 1M tokens.',
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    tool('list_models', async () => json(await listModelsFor(ctx, catalog, settings))),
  );

  server.registerTool(
    'get_balance',
    {
      title: 'Saldo',
      description:
        'Saldo da organização, ou de um usuário final do projeto quando externalId é informado. Valores em micro-reais (texto) e em reais.',
      inputSchema: { externalId: z.string().min(1).max(128).optional() },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    tool<{ externalId?: string }>('get_balance', async ({ externalId }) => {
      const wallet = externalId
        ? (
            await prisma.appUser.findUnique({
              where: { projectId_externalId: { projectId: ctx.project.id, externalId } },
              include: { wallet: true },
            })
          )?.wallet
        : await prisma.wallet.findUnique({ where: { orgId: ctx.org.id } });
      if (!wallet)
        return fail(
          externalId ? `Usuário final "${externalId}" não encontrado.` : 'Carteira não encontrada.',
        );
      const available = wallet.balanceMicros - wallet.reservedMicros;
      return json({
        owner: externalId ? 'app_user' : 'organization',
        balance: microsToBrl(wallet.balanceMicros),
        available: microsToBrl(available),
        balance_micros: wallet.balanceMicros.toString(),
        available_micros: available.toString(),
      });
    }),
  );

  server.registerTool(
    'get_usage',
    {
      title: 'Consumo',
      description: 'Consumo do projeto por modelo (padrão: últimos 30 dias; máximo 366).',
      inputSchema: {
        from: z.iso.datetime({ offset: true }).optional().describe('Início ISO 8601'),
        to: z.iso.datetime({ offset: true }).optional().describe('Fim ISO 8601'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    tool<{ from?: string; to?: string }>('get_usage', async (args) => {
      const to = args.to ? new Date(args.to) : new Date();
      const from = args.from ? new Date(args.from) : new Date(to.getTime() - 30 * 86_400_000);
      if (from > to || to.getTime() - from.getTime() > 366 * 86_400_000) {
        return fail('Período inválido (máximo de 366 dias).');
      }
      return json(await usageSummary(prisma, catalog, ctx.project.id, from, to));
    }),
  );

  server.registerTool(
    'test_chat',
    {
      title: 'Chamada de teste (cobrada)',
      description:
        'Faz uma chamada curta real a /v1/chat/completions com esta chave (até 64 tokens de saída). É COBRADA do saldo. Útil para validar a integração.',
      inputSchema: {
        model: z
          .string()
          .min(1)
          .optional()
          .describe('Slug do modelo; padrão: modelo padrão do projeto'),
        message: z.string().min(1).max(500).optional(),
        externalId: z
          .string()
          .min(1)
          .max(128)
          .optional()
          .describe('Cobrar de um usuário final (obrigatório em END_USER_WALLET)'),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    tool<{ model?: string; message?: string; externalId?: string }>('test_chat', async (args) => {
      const snap = await snapshot();
      const model = args.model ?? snap.defaultModel ?? snap.models[0]?.id;
      if (!model) return fail('Nenhum modelo disponível para este projeto.');
      const res = await deps.inject({
        method: 'POST',
        url: '/v1/chat/completions',
        headers: {
          authorization: deps.authorization,
          'content-type': 'application/json',
          ...(args.externalId ? { 'x-fuse-user': args.externalId } : {}),
        },
        payload: {
          model,
          max_tokens: 64,
          messages: [
            {
              role: 'user',
              content: args.message ?? 'Responda só: OK, integração fusai funcionando.',
            },
          ],
        },
      });
      const body = res.json() as {
        choices?: { message?: { content?: string } }[];
        usage?: unknown;
        error?: { message: string; code: string };
      };
      if (res.statusCode !== 200) {
        return fail(
          `HTTP ${res.statusCode} ${body.error?.code ?? ''}: ${body.error?.message ?? 'erro'}`,
        );
      }
      return json({
        model,
        answer: body.choices?.[0]?.message?.content ?? '',
        usage: body.usage,
        requestId: res.headers['x-fuse-request-id'],
      });
    }),
  );

  server.registerTool(
    'list_packages',
    {
      title: 'Pacotes de créditos',
      description: 'Pacotes que os usuários finais deste projeto podem comprar via Pix.',
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    tool('list_packages', async () => {
      const packages = await prisma.creditPackage.findMany({
        where: { projectId: ctx.project.id },
        orderBy: [{ sortOrder: 'asc' }, { priceCents: 'asc' }],
      });
      return json(
        packages.map((p) => ({
          id: p.id,
          name: p.name,
          priceCents: p.priceCents,
          creditMicros: p.creditMicros.toString(),
          bonusMicros: p.bonusMicros.toString(),
          highlight: p.highlight,
          active: p.active,
        })),
      );
    }),
  );

  server.registerTool(
    'create_package',
    {
      title: 'Criar pacote de créditos',
      description:
        'Cria um pacote para os usuários finais comprarem via Pix. Valores em reais como texto ("9.90"). Preço mínimo R$ 0,01. Altera o projeto.',
      inputSchema: {
        name: z.string().min(2).max(60),
        price_brl: z.string().describe('Preço cobrado no Pix, ex.: "9.90"'),
        credits_brl: z.string().describe('Créditos entregues, ex.: "9.00"'),
        bonus_brl: z.string().optional().describe('Bônus extra, ex.: "1.00"'),
        highlight: z.boolean().optional(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    tool<{
      name: string;
      price_brl: string;
      credits_brl: string;
      bonus_brl?: string;
      highlight?: boolean;
    }>('create_package', async (args) => {
      let price: bigint;
      let credit: bigint;
      let bonus: bigint;
      try {
        price = brlToMicros(args.price_brl);
        credit = brlToMicros(args.credits_brl);
        bonus = args.bonus_brl ? brlToMicros(args.bonus_brl) : 0n;
      } catch {
        return fail('Valores inválidos. Use reais como texto, ex.: "9.90".');
      }
      if (price % 10_000n !== 0n) return fail('O preço precisa estar em centavos inteiros.');
      const parsed = projectPackageSchema.safeParse({
        name: args.name,
        priceCents: Number(price / 10_000n),
        creditMicros: credit.toString(),
        bonusMicros: bonus.toString(),
        highlight: args.highlight ?? false,
        active: true,
        sortOrder: 0,
      });
      if (!parsed.success) return fail(parsed.error.issues.map((i) => i.message).join('; '));
      if ((await prisma.creditPackage.count({ where: { projectId: ctx.project.id } })) >= 20) {
        return fail('Limite de 20 pacotes por projeto.');
      }
      const d = parsed.data;
      const pkg = await prisma.creditPackage.create({
        data: {
          ...d,
          projectId: ctx.project.id,
          creditMicros: BigInt(d.creditMicros),
          bonusMicros: BigInt(d.bonusMicros),
        },
      });
      return json({
        id: pkg.id,
        name: pkg.name,
        priceCents: pkg.priceCents,
        creditMicros: pkg.creditMicros.toString(),
        bonusMicros: pkg.bonusMicros.toString(),
      });
    }),
  );

  server.registerTool(
    'update_project_settings',
    {
      title: 'Alterar configurações do projeto',
      description:
        'Altera origens permitidas, URL do webhook e/ou modo de cobrança. Sem confirm=true, só mostra o que mudaria. Peça confirmação ao usuário antes de aplicar.',
      inputSchema: {
        allowedOrigins: z
          .array(z.string())
          .max(20)
          .optional()
          .describe('Lista completa (substitui a atual), ex.: ["https://app.exemplo.com"]'),
        // A plain string (not nullable): `type: ["string","null"]` breaks some MCP clients.
        webhookUrl: z
          .string()
          .max(500)
          .optional()
          .describe('URL https do webhook; "" (texto vazio) remove'),
        billingMode: z.enum(['ORG_WALLET', 'END_USER_WALLET', 'HYBRID']).optional(),
        confirm: z.boolean().optional().describe('true para aplicar'),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    tool<{
      allowedOrigins?: string[];
      webhookUrl?: string;
      billingMode?: 'ORG_WALLET' | 'END_USER_WALLET' | 'HYBRID';
      confirm?: boolean;
    }>('update_project_settings', async ({ confirm, ...changes }) => {
      const parsed = projectUpdateSchema.safeParse({
        ...changes,
        ...(changes.webhookUrl === '' ? { webhookUrl: null } : {}),
      });
      if (!parsed.success)
        return fail(parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
      // Only the fields this tool exposes (the shared schema has more).
      const { allowedOrigins, webhookUrl, billingMode } = parsed.data;
      const body = Object.fromEntries(
        Object.entries({ allowedOrigins, webhookUrl, billingMode }).filter(
          ([, v]) => v !== undefined,
        ),
      ) as {
        allowedOrigins?: string[];
        webhookUrl?: string | null;
        billingMode?: typeof billingMode;
      };
      if (Object.keys(body).length === 0) return fail('Nada para alterar.');
      if (
        body.webhookUrl &&
        env.NODE_ENV === 'production' &&
        !body.webhookUrl.startsWith('https://')
      ) {
        return fail('O webhook precisa usar https.');
      }
      const current = await project();
      const diff = Object.fromEntries(
        Object.entries(body).map(([k, v]) => [
          k,
          { de: current[k as keyof typeof current], para: v },
        ]),
      );
      if (!confirm) {
        return json({
          preview: diff,
          aplicado: false,
          instrucao: 'Confirme com o usuário e chame de novo com confirm: true.',
        });
      }
      await prisma.project.update({
        where: { id: current.id },
        data: {
          ...body,
          ...(body.allowedOrigins ? { allowedOrigins: [...new Set(body.allowedOrigins)] } : {}),
          ...(body.webhookUrl && !current.webhookSecret
            ? {
                webhookSecret: encryptSecret(
                  `whsec_${randomBytes(32).toString('base64url')}`,
                  deps.encryptionKey,
                ),
              }
            : {}),
        },
      });
      await audit('update_project_settings.applied', { fields: Object.keys(body) });
      return json({ aplicado: true, alteracoes: diff });
    }),
  );

  server.registerTool(
    'create_test_checkout',
    {
      title: 'Checkout Pix de teste',
      description:
        'Gera um checkout Pix de teste para um usuário final (cria o usuário se preciso). Só com chave fai_test_ e Asaas em sandbox: nenhum dinheiro real.',
      inputSchema: {
        packageId: z.string().min(1).optional().describe('Padrão: primeiro pacote ativo'),
        externalId: z.string().min(1).max(128).optional().describe('Padrão: "mcp-teste"'),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    tool<{ packageId?: string; externalId?: string }>('create_test_checkout', async (args) => {
      if (ctx.env !== 'TEST' || env.ASAAS_ENV !== 'sandbox') {
        return fail(
          'create_test_checkout só funciona com uma chave de teste (fai_test_) e o Asaas em sandbox.',
        );
      }
      const p = await prisma.project.findUniqueOrThrow({
        where: { id: ctx.project.id },
        include: { org: true },
      });
      if (p.billingMode === 'ORG_WALLET') {
        return fail(
          'O projeto está em ORG_WALLET: usuários finais não compram créditos. Mude o modo com update_project_settings.',
        );
      }
      const pkg = args.packageId
        ? { id: args.packageId }
        : await prisma.creditPackage.findFirst({
            where: { projectId: p.id, active: true },
            orderBy: { sortOrder: 'asc' },
          });
      if (!pkg) return fail('Nenhum pacote ativo. Crie um com create_package.');
      const { user } = await upsertAppUser(prisma, p, {
        externalId: args.externalId ?? 'mcp-teste',
        name: 'Usuário de teste MCP',
      });
      const appUser = await prisma.appUser.findUniqueOrThrow({
        where: { id: user.id },
        include: { wallet: true },
      });
      const payment = await createAppUserCheckout(prisma, deps.provider, p, appUser, {
        packageId: pkg.id,
        document: appUser.document ?? SANDBOX_CPF,
      });
      return json({
        ...serializeCheckout(payment, env.APP_URL),
        dica: 'Abra hostedUrl, depois confirme o pagamento no painel do sandbox do Asaas (Cobranças → Confirmar pagamento).',
      });
    }),
  );

  server.registerTool(
    'send_test_webhook',
    {
      title: 'Enviar webhook de teste',
      description:
        'Envia um evento test.ping assinado para o webhook do projeto e devolve o resultado.',
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    tool('send_test_webhook', async () => {
      const p = await project();
      if (!p.webhookUrl)
        return fail('O projeto não tem URL de webhook. Configure com update_project_settings.');
      const hook = await emitEvent(prisma, p.id, 'test.ping', {
        message: 'Webhook de teste da fusai (MCP)',
      });
      if (!hook) return fail('O projeto não tem URL de webhook.');
      await deliverWebhook(prisma, hook.id, {
        encryptionKey: deps.encryptionKey,
        production: env.NODE_ENV === 'production',
      });
      const after = await prisma.outboundWebhook.findUniqueOrThrow({ where: { id: hook.id } });
      return json({
        url: p.webhookUrl,
        status: after.status,
        responseStatus: after.responseStatus,
        error: after.lastError,
      });
    }),
  );

  // ---- Resources ----
  const docResource = (name: 'api' | 'sdk' | 'checkout', title: string) =>
    server.registerResource(
      `docs-${name}`,
      `fusai://docs/${name}`,
      { title, mimeType: 'text/markdown' },
      async (uri) => {
        await audit(`resource.docs.${name}`);
        return {
          contents: [{ uri: uri.href, mimeType: 'text/markdown', text: docBundle(name, urls) }],
        };
      },
    );
  docResource('api', 'Referência da API fusai');
  docResource('sdk', 'SDKs (@fusai/sdk, @fusai/react, OpenAI)');
  docResource('checkout', 'Usuários finais, checkout Pix e webhooks');
  server.registerResource(
    'project',
    'fusai://project',
    { title: `Projeto ${ctx.project.name} (FUSAI.md)`, mimeType: 'text/markdown' },
    async (uri) => {
      await audit('resource.project');
      return {
        contents: [
          { uri: uri.href, mimeType: 'text/markdown', text: fusaiMd(await snapshot(), urls) },
        ],
      };
    },
  );

  // ---- Prompts ----
  const prompt = (body: string) => ({
    messages: [{ role: 'user' as const, content: { type: 'text' as const, text: body } }],
  });
  server.registerPrompt(
    'integrar_chat',
    {
      title: 'Integrar chat com IA',
      description: 'Adiciona chat com IA da fusai ao app atual.',
      argsSchema: {
        stack: z
          .string()
          .optional()
          .describe('nextjs, react-native, flutter, node, python, laravel'),
      },
    },
    ({ stack }) =>
      prompt(
        `Integre um chat com IA neste projeto usando a fusai. Passos: 1) chame a tool get_integration_guide${stack ? ` com stack "${stack}"` : ' com a stack deste projeto'}; 2) siga as regras de segurança (chave só no servidor, session token no front); 3) implemente o chat com streaming e trate 402/429; 4) valide com test_chat. Mostre os arquivos alterados no fim.`,
      ),
  );
  server.registerPrompt(
    'integrar_compra_pix',
    {
      title: 'Integrar compra de créditos via Pix',
      description: 'Usuários finais compram créditos com Pix e consomem a IA com saldo próprio.',
      argsSchema: { stack: z.string().optional() },
    },
    ({ stack }) =>
      prompt(
        `Implemente a compra de créditos via Pix para os usuários deste app com a fusai. Passos: 1) get_project_config (se o modo for ORG_WALLET, pergunte se devo mudar para END_USER_WALLET ou HYBRID com update_project_settings); 2) list_packages (se não houver, proponha pacotes e crie com create_package após confirmação); 3) get_integration_guide${stack ? ` com stack "${stack}"` : ''}; 4) implemente: upsert do usuário final, rota de session token, saldo, checkout (FusaiCheckout ou página hospedada) e webhook com verificação de assinatura; 5) cadastre a origem do front e a URL do webhook (update_project_settings, com confirmação); 6) teste com send_test_webhook e, com chave de teste, create_test_checkout.`,
      ),
  );
  server.registerPrompt(
    'migrar_de_openai',
    {
      title: 'Migrar da OpenAI para a fusai',
      description: 'Troca o provedor de IA do app para a fusai mantendo o código do SDK da OpenAI.',
    },
    () =>
      prompt(
        `Migre este projeto da OpenAI para a fusai. Mantenha o SDK oficial da OpenAI e troque só a configuração: apiKey = process.env.FUSAI_API_KEY e baseURL = "${env.API_URL}/v1" (ou equivalente na linguagem). Use list_models para escolher modelos equivalentes aos usados hoje e substitua os nomes (ex.: gpt-4o-mini → um modelo fuse/*). Atualize .env.example sem colocar a chave real. No fim, valide com test_chat.`,
      ),
  );

  return server;
}
