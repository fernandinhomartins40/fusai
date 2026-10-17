import { randomUUID } from 'node:crypto';
import type { AgentKey, Organization, PrismaClient, Project, Wallet } from '@fusai/db';
import {
  agentSetupGuide,
  DOC_PAGES,
  type DocUrls,
  docMarkdown,
  GUIDE_STACKS,
  type GuideStack,
  getDoc,
  integrationGuide,
  searchDocPages,
  USE_CASE_BILLING,
  USE_CASES,
  type UseCase,
} from '@fusai/docs';
import { microsToBrl, PIX_MIN_CENTS } from '@fusai/shared';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { Env } from '../../lib/env';
import { HttpError } from '../../lib/errors';
import type { SettingsStore } from '../../lib/settings';
import { type PaymentProvider, PaymentProviderError } from '../../payments/types';
import { API_KEY_SCOPES, generateApiKey, hashApiKey, keyDisplayPrefix } from '../api-keys/keys';
import { serializeAppUser } from '../app-users/service';
import { applyLedger } from '../billing/wallet';
import { serializeKey } from '../dashboard/api-keys';
import { createProject } from '../dashboard/organizations';
import type { CatalogStore } from '../gateway/catalog';
import { listModelsFor, usageSummary } from '../gateway/queries';
import { projectSnapshot } from '../integration/snapshot';
import { createOrgTopup, minTopupCents, serializePayment } from '../payments/service';
import {
  createPackage,
  parseBrl,
  sendTestWebhook,
  serializePackageForAi,
  updateProjectSettings,
} from './actions';
import { fail, json, result, text } from './server';

/** Who is calling: an organization-wide agent key, acting as the member who created it. */
export type AgentContext = {
  key: AgentKey;
  org: Organization & { wallet: Wallet | null };
  /** The OWNER/ADMIN who created the key (checked on every request). */
  actorId: string;
};

export type AgentDeps = {
  prisma: PrismaClient;
  catalog: CatalogStore;
  settings: SettingsStore;
  provider: PaymentProvider;
  env: Env;
  encryptionKey: Buffer;
  ip: string;
};

const projectArg = z.string().min(1).max(80).describe('Id ou slug do projeto (veja list_projects)');
const confirmArg = z.boolean().optional().describe('true para aplicar (peça confirmação antes)');
const readOnly = { readOnlyHint: true, openWorldHint: false } as const;
const writes = (destructive = false) =>
  ({
    readOnlyHint: false,
    destructiveHint: destructive,
    idempotentHint: false,
    openWorldHint: false,
  }) as const;

const USE_CASE_TEXT: Record<UseCase, string> = {
  uso_proprio: 'uso próprio: a organização paga todo o consumo',
  revenda: 'revenda: cada usuário final compra créditos com Pix e paga o que usa',
  hibrido: 'híbrido: usa o saldo do usuário final e, quando acaba, o da organização',
};

/**
 * Agent MCP (D-123): one stateless server per request for an organization-wide `fai_agent_` key.
 * The customer's AI configures everything (projects, keys, packages, Pix top-ups) and gets the
 * implementation guide. Every tool call is in the audit log, attributed to the key's creator.
 */
export function buildAgentMcpServer(ctx: AgentContext, deps: AgentDeps) {
  const { prisma, catalog, settings, env } = deps;
  const urls: DocUrls = { api: env.API_URL, app: env.APP_URL };
  const hookOpts = { encryptionKey: deps.encryptionKey, production: env.NODE_ENV === 'production' };
  const orgId = ctx.org.id;

  const audit = (action: string, target: string | null, metadata: Record<string, unknown> = {}) =>
    prisma.auditLog.create({
      data: {
        actorId: ctx.actorId,
        action: `mcp.agent.${action}`,
        target,
        metadata: { agentKeyId: ctx.key.id, orgId, ...metadata },
        ip: deps.ip,
      },
    });

  function tool<A>(name: string, run: (args: A) => Promise<ReturnType<typeof json>>) {
    return async (args: A) => {
      await audit(name, (args as { project?: string } | undefined)?.project ?? null);
      try {
        return await run(args);
      } catch (err) {
        if (err instanceof HttpError) return fail(err.message);
        if (err instanceof PaymentProviderError) return fail(`Asaas: ${err.message}`);
        throw err;
      }
    };
  }

  /** A project of THIS organization, by id or slug. */
  async function findProject(ref: string): Promise<Project> {
    const project = await prisma.project.findFirst({
      where: { orgId, OR: [{ id: ref }, { slug: ref }] },
    });
    if (!project)
      throw new HttpError(404, 'not_found', `Projeto "${ref}" não encontrado nesta organização.`);
    return project;
  }

  const server = new McpServer(
    { name: 'fusai-agent', title: 'fusai (agente da organização)', version: '1.0.0' },
    {
      instructions: `fusai: gateway de IA compatível com OpenAI, cobrança em reais e Pix. Esta conexão usa a chave de agente da organização "${ctx.org.name}" e pode configurar tudo: projetos, chaves, pacotes, recargas Pix. Comece com get_account e get_setup_guide. Casos: uso próprio (a organização paga), revenda (usuários finais compram créditos com Pix) ou híbrido. Peça confirmação ao usuário antes de ações com confirm. Nunca escreva chaves (fai_live_, fai_agent_) em arquivos versionados nem no front-end.`,
    },
  );

  // ---------------------------------------------------------------- leitura
  server.registerTool(
    'get_account',
    {
      title: 'Conta e projetos',
      description:
        'Organização, saldo da carteira, tipo de cobrança, projetos (com modo de cobrança) e links. Use primeiro.',
      annotations: readOnly,
    },
    tool('get_account', async () => {
      const [projects, s] = await Promise.all([
        prisma.project.findMany({
          where: { orgId },
          orderBy: { createdAt: 'asc' },
          include: {
            _count: { select: { apiKeys: { where: { revokedAt: null } }, appUsers: true } },
          },
        }),
        settings.get(),
      ]);
      const w = ctx.org.wallet;
      const available = (w?.balanceMicros ?? 0n) - (w?.reservedMicros ?? 0n);
      return json({
        organization: {
          id: orgId,
          name: ctx.org.name,
          status: ctx.org.status,
          billingType: ctx.org.billingType,
          hasDocument: !!ctx.org.document,
        },
        wallet: {
          balance: microsToBrl(w?.balanceMicros ?? 0n),
          available: microsToBrl(available),
          minTopup: microsToBrl(BigInt(minTopupCents(s)) * 10_000n),
        },
        projects: projects.map((p) => ({
          id: p.id,
          name: p.name,
          slug: p.slug,
          billingMode: p.billingMode,
          activeApiKeys: p._count.apiKeys,
          endUsers: p._count.appUsers,
          webhookUrl: p.webhookUrl,
          allowedOrigins: p.allowedOrigins,
        })),
        links: {
          painel: `${env.APP_URL}/app`,
          docs: `${env.APP_URL}/docs`,
          api: `${env.API_URL}/v1`,
        },
      });
    }),
  );

  server.registerTool(
    'get_setup_guide',
    {
      title: 'Guia de configuração (uso próprio, revenda ou híbrido)',
      description:
        'Passo a passo com as tools a chamar e o que implementar no sistema do usuário para cada caso de uso.',
      inputSchema: {
        use_case: z
          .enum(USE_CASES)
          .optional()
          .describe('uso_proprio, revenda ou hibrido (vazio = os três)'),
      },
      annotations: readOnly,
    },
    tool<{ use_case?: UseCase }>('get_setup_guide', async ({ use_case }) =>
      text(agentSetupGuide(urls, use_case)),
    ),
  );

  server.registerTool(
    'search_docs',
    {
      title: 'Buscar na documentação',
      description:
        'Busca nas páginas da documentação da fusai e devolve as mais relevantes com um trecho.',
      inputSchema: { query: z.string().min(2).max(200) },
      annotations: readOnly,
    },
    tool<{ query: string }>('search_docs', async ({ query }) => {
      const results = searchDocPages(DOC_PAGES, query);
      if (results.length === 0) return text('Nada encontrado. Tente outras palavras.');
      return json(results.map(({ score: _s, ...r }) => r));
    }),
  );

  server.registerTool(
    'read_doc',
    {
      title: 'Ler página da documentação',
      description: `Página inteira em Markdown. Slugs: ${DOC_PAGES.map((p) => p.slug).join(', ')}.`,
      inputSchema: { slug: z.string().min(1).max(80) },
      annotations: readOnly,
    },
    tool<{ slug: string }>('read_doc', async ({ slug }) => {
      const page = getDoc(slug);
      return page ? text(docMarkdown(page, urls)) : fail(`Página "${slug}" não existe.`);
    }),
  );

  server.registerTool(
    'list_projects',
    { title: 'Projetos', description: 'Projetos da organização.', annotations: readOnly },
    tool('list_projects', async () => {
      const projects = await prisma.project.findMany({
        where: { orgId },
        orderBy: { createdAt: 'asc' },
      });
      return json(
        projects.map((p) => ({ id: p.id, name: p.name, slug: p.slug, billingMode: p.billingMode })),
      );
    }),
  );

  server.registerTool(
    'get_project_config',
    {
      title: 'Configuração do projeto',
      description:
        'Modo de cobrança, origens permitidas, webhook, crédito grátis, pacotes e modelos.',
      inputSchema: { project: projectArg },
      annotations: readOnly,
    },
    tool<{ project: string }>('get_project_config', async (args) => {
      const p = await findProject(args.project);
      const snap = await projectSnapshot(prisma, catalog, settings, p, ctx.org);
      return json({
        project: { id: p.id, name: p.name, slug: p.slug },
        baseUrl: `${env.API_URL}/v1`,
        billingMode: p.billingMode,
        allowedOrigins: p.allowedOrigins,
        webhookUrl: p.webhookUrl,
        hasWebhookSecret: !!p.webhookSecret,
        freeCredit: microsToBrl(p.freeCreditMicros),
        defaultModel: snap.defaultModel,
        packages: snap.packages,
        models: snap.models,
      });
    }),
  );

  server.registerTool(
    'get_integration_guide',
    {
      title: 'Guia de implementação do projeto',
      description:
        'Código e checklist para a stack do sistema, já com o modo de cobrança, modelos e pacotes do projeto.',
      inputSchema: {
        project: projectArg,
        stack: z.enum(GUIDE_STACKS).optional().describe(GUIDE_STACKS.join(', ')),
      },
      annotations: readOnly,
    },
    tool<{ project: string; stack?: GuideStack }>('get_integration_guide', async (args) => {
      const p = await findProject(args.project);
      const snap = await projectSnapshot(prisma, catalog, settings, p, ctx.org);
      return text(integrationGuide(snap, urls, args.stack));
    }),
  );

  server.registerTool(
    'list_models',
    {
      title: 'Modelos e preços',
      description:
        'Modelos disponíveis e preços em R$ por 1M tokens (com a margem desta organização).',
      inputSchema: { project: projectArg.optional() },
      annotations: readOnly,
    },
    tool<{ project?: string }>('list_models', async (args) => {
      const project = args.project
        ? await findProject(args.project)
        : ({ allowedModelIds: [] } as unknown as Project);
      return json(await listModelsFor({ org: ctx.org, project, env: 'LIVE' }, catalog, settings));
    }),
  );

  server.registerTool(
    'get_balance',
    {
      title: 'Saldo',
      description:
        'Saldo da organização ou, com project + externalId, de um usuário final. Em reais e micro-reais.',
      inputSchema: {
        project: projectArg.optional(),
        externalId: z.string().min(1).max(128).optional(),
      },
      annotations: readOnly,
    },
    tool<{ project?: string; externalId?: string }>('get_balance', async (args) => {
      let wallet: Wallet | null;
      if (args.externalId) {
        if (!args.project) return fail('Informe o project junto com o externalId.');
        const p = await findProject(args.project);
        wallet =
          (
            await prisma.appUser.findUnique({
              where: { projectId_externalId: { projectId: p.id, externalId: args.externalId } },
              include: { wallet: true },
            })
          )?.wallet ?? null;
        if (!wallet) return fail(`Usuário final "${args.externalId}" não encontrado.`);
      } else {
        wallet = await prisma.wallet.findUnique({ where: { orgId } });
        if (!wallet) return fail('Carteira não encontrada.');
      }
      const available = wallet.balanceMicros - wallet.reservedMicros;
      return json({
        owner: args.externalId ? 'app_user' : 'organization',
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
        project: projectArg,
        from: z.iso.datetime({ offset: true }).optional(),
        to: z.iso.datetime({ offset: true }).optional(),
      },
      annotations: readOnly,
    },
    tool<{ project: string; from?: string; to?: string }>('get_usage', async (args) => {
      const p = await findProject(args.project);
      const to = args.to ? new Date(args.to) : new Date();
      const from = args.from ? new Date(args.from) : new Date(to.getTime() - 30 * 86_400_000);
      if (from > to || to.getTime() - from.getTime() > 366 * 86_400_000)
        return fail('Período inválido (máximo de 366 dias).');
      return json(await usageSummary(prisma, catalog, p.id, from, to));
    }),
  );

  server.registerTool(
    'list_api_keys',
    {
      title: 'Chaves de API do projeto',
      description: 'Chaves do projeto (só o prefixo; a chave completa não é guardada).',
      inputSchema: { project: projectArg },
      annotations: readOnly,
    },
    tool<{ project: string }>('list_api_keys', async (args) => {
      const p = await findProject(args.project);
      const keys = await prisma.apiKey.findMany({
        where: { projectId: p.id },
        orderBy: [{ revokedAt: { sort: 'desc', nulls: 'first' } }, { createdAt: 'desc' }],
      });
      return json(keys.map(serializeKey));
    }),
  );

  server.registerTool(
    'list_packages',
    {
      title: 'Pacotes de créditos',
      description: 'Pacotes que os usuários finais do projeto compram via Pix.',
      inputSchema: { project: projectArg },
      annotations: readOnly,
    },
    tool<{ project: string }>('list_packages', async (args) => {
      const p = await findProject(args.project);
      const packages = await prisma.creditPackage.findMany({
        where: { projectId: p.id },
        orderBy: [{ sortOrder: 'asc' }, { priceCents: 'asc' }],
      });
      return json(packages.map(serializePackageForAi));
    }),
  );

  server.registerTool(
    'list_end_users',
    {
      title: 'Usuários finais',
      description:
        'Usuários finais do projeto com saldo (até 50, filtro opcional por id, nome ou email).',
      inputSchema: { project: projectArg, search: z.string().trim().max(120).optional() },
      annotations: readOnly,
    },
    tool<{ project: string; search?: string }>('list_end_users', async (args) => {
      const p = await findProject(args.project);
      const q = args.search;
      const users = await prisma.appUser.findMany({
        where: {
          projectId: p.id,
          ...(q
            ? {
                OR: [
                  { externalId: { contains: q, mode: 'insensitive' } },
                  { email: { contains: q, mode: 'insensitive' } },
                  { name: { contains: q, mode: 'insensitive' } },
                ],
              }
            : {}),
        },
        orderBy: { createdAt: 'desc' },
        take: 50,
        include: { wallet: true },
      });
      return json(users.map((u) => serializeAppUser(u, u.wallet)));
    }),
  );

  server.registerTool(
    'list_payments',
    {
      title: 'Pagamentos Pix',
      description:
        'Últimos pagamentos Pix da organização: recargas da carteira e compras dos usuários finais.',
      inputSchema: {
        project: projectArg.optional().describe('Só as compras dos usuários finais deste projeto'),
        limit: z.number().int().min(1).max(50).optional(),
      },
      annotations: readOnly,
    },
    tool<{ project?: string; limit?: number }>('list_payments', async (args) => {
      const p = args.project ? await findProject(args.project) : null;
      const payments = await prisma.payment.findMany({
        where: { orgId, ...(p ? { projectId: p.id } : {}) },
        orderBy: { createdAt: 'desc' },
        take: args.limit ?? 20,
      });
      return json(
        payments.map((pay) => {
          const { pixQrBase64: _qr, ...rest } = serializePayment(pay);
          return { ...rest, endUser: !!pay.appUserId, projectId: pay.projectId };
        }),
      );
    }),
  );

  // ---------------------------------------------------------------- escrita
  server.registerTool(
    'create_project',
    {
      title: 'Criar projeto',
      description:
        'Cria um projeto (um sistema/app). use_case: uso_proprio (organização paga), revenda (usuários finais compram créditos com Pix) ou hibrido.',
      inputSchema: {
        name: z.string().trim().min(2).max(60),
        use_case: z.enum(USE_CASES),
      },
      annotations: writes(),
    },
    tool<{ name: string; use_case: UseCase }>('create_project', async (args) => {
      const p = await createProject(prisma, ctx.actorId, orgId, {
        name: args.name,
        billingMode: USE_CASE_BILLING[args.use_case],
      });
      return json({
        id: p.id,
        name: p.name,
        slug: p.slug,
        billingMode: p.billingMode,
        caso: USE_CASE_TEXT[args.use_case],
        proximo_passo:
          args.use_case === 'uso_proprio'
            ? 'create_api_key e depois get_integration_guide com a stack do sistema.'
            : 'create_package (2 ou 3 pacotes), update_project_settings (origens e webhook), create_api_key e get_integration_guide.',
      });
    }),
  );

  server.registerTool(
    'create_api_key',
    {
      title: 'Criar chave de API do projeto',
      description:
        'Cria uma chave secreta do projeto. A chave completa aparece UMA vez: grave em FUSAI_API_KEY no .env do servidor (nunca no front nem no repositório).',
      inputSchema: {
        project: projectArg,
        name: z.string().trim().min(2).max(60).describe('Ex.: "Servidor de produção"'),
        env: z.enum(['live', 'test']).optional().describe('live (padrão) ou test'),
        scopes: z
          .array(z.enum(API_KEY_SCOPES))
          .min(1)
          .optional()
          .describe(API_KEY_SCOPES.join(', ')),
      },
      annotations: writes(),
    },
    tool<{ project: string; name: string; env?: 'live' | 'test'; scopes?: string[] }>(
      'create_api_key',
      async (args) => {
        const p = await findProject(args.project);
        const keyEnv = args.env === 'test' ? 'TEST' : 'LIVE';
        const plain = generateApiKey(keyEnv);
        const key = await prisma.apiKey.create({
          data: {
            projectId: p.id,
            name: args.name,
            env: keyEnv,
            prefix: keyDisplayPrefix(plain),
            hash: hashApiKey(plain, env.KEY_PEPPER),
            scopes: args.scopes ?? [...API_KEY_SCOPES],
            createdById: ctx.actorId,
          },
        });
        await audit('create_api_key.created', p.id, { apiKeyId: key.id, prefix: key.prefix });
        return json({
          ...serializeKey(key),
          key: plain,
          aviso:
            'Esta é a única vez que a chave aparece. Grave em FUSAI_API_KEY no .env do servidor e confira que .env está no .gitignore.',
        });
      },
    ),
  );

  server.registerTool(
    'revoke_api_key',
    {
      title: 'Revogar chave de API',
      description:
        'Revoga uma chave do projeto na hora: os sistemas que a usam param. Pede confirm.',
      inputSchema: { project: projectArg, key_id: z.string().min(1), confirm: confirmArg },
      annotations: writes(true),
    },
    tool<{ project: string; key_id: string; confirm?: boolean }>('revoke_api_key', async (args) => {
      const p = await findProject(args.project);
      const key = await prisma.apiKey.findFirst({ where: { id: args.key_id, projectId: p.id } });
      if (!key) return fail('Chave não encontrada neste projeto.');
      if (key.revokedAt) return json({ revogada: true, ja_estava: true });
      if (!args.confirm)
        return json({
          preview: { chave: key.name, prefixo: key.prefix, ultimo_uso: key.lastUsedAt },
          aplicado: false,
          instrucao: 'Confirme com o usuário e chame de novo com confirm: true.',
        });
      await prisma.apiKey.update({ where: { id: key.id }, data: { revokedAt: new Date() } });
      await audit('revoke_api_key.applied', p.id, { apiKeyId: key.id, prefix: key.prefix });
      return json({ revogada: true });
    }),
  );

  server.registerTool(
    'update_project_settings',
    {
      title: 'Alterar configurações do projeto',
      description:
        'Origens permitidas do front, URL do webhook, modo de cobrança e crédito grátis por usuário novo. Sem confirm=true só mostra o que mudaria.',
      inputSchema: {
        project: projectArg,
        allowedOrigins: z
          .array(z.string())
          .max(20)
          .optional()
          .describe('Lista completa (substitui a atual), ex.: ["https://app.exemplo.com"]'),
        webhookUrl: z.string().max(500).optional().describe('URL https; "" remove'),
        billingMode: z.enum(['ORG_WALLET', 'END_USER_WALLET', 'HYBRID']).optional(),
        free_credit_brl: z
          .string()
          .optional()
          .describe('Crédito grátis por usuário novo, ex.: "1.00"'),
        confirm: confirmArg,
      },
      annotations: { ...writes(true), idempotentHint: true },
    },
    tool<{
      project: string;
      allowedOrigins?: string[];
      webhookUrl?: string;
      billingMode?: 'ORG_WALLET' | 'END_USER_WALLET' | 'HYBRID';
      free_credit_brl?: string;
      confirm?: boolean;
    }>('update_project_settings', async ({ project, confirm, ...changes }) => {
      const p = await findProject(project);
      const res = await updateProjectSettings(prisma, hookOpts, p, changes, !!confirm);
      if (res.ok && confirm)
        await audit('update_project_settings.applied', p.id, { fields: Object.keys(changes) });
      return result(res);
    }),
  );

  server.registerTool(
    'create_package',
    {
      title: 'Criar pacote de créditos',
      description:
        'Pacote que os usuários finais compram via Pix. Reais como texto ("9.90"). Preço mínimo R$ 5,00.',
      inputSchema: {
        project: projectArg,
        name: z.string().min(2).max(60),
        price_brl: z.string().describe('Preço no Pix, ex.: "9.90"'),
        credits_brl: z.string().describe('Créditos entregues, ex.: "9.00"'),
        bonus_brl: z.string().optional().describe('Bônus extra, ex.: "1.00"'),
        highlight: z.boolean().optional(),
      },
      annotations: writes(),
    },
    tool<{
      project: string;
      name: string;
      price_brl: string;
      credits_brl: string;
      bonus_brl?: string;
      highlight?: boolean;
    }>('create_package', async ({ project, ...args }) => {
      const p = await findProject(project);
      return result(await createPackage(prisma, p.id, args));
    }),
  );

  server.registerTool(
    'update_package',
    {
      title: 'Alterar ou desativar pacote',
      description: 'Muda nome, destaque ou ativa/desativa um pacote do projeto.',
      inputSchema: {
        project: projectArg,
        package_id: z.string().min(1),
        name: z.string().min(2).max(60).optional(),
        highlight: z.boolean().optional(),
        active: z.boolean().optional(),
      },
      annotations: { ...writes(), idempotentHint: true },
    },
    tool<{
      project: string;
      package_id: string;
      name?: string;
      highlight?: boolean;
      active?: boolean;
    }>('update_package', async ({ project, package_id, ...data }) => {
      const p = await findProject(project);
      const fields = Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined));
      if (Object.keys(fields).length === 0) return fail('Nada para alterar.');
      const res = await prisma.creditPackage.updateMany({
        where: { id: package_id, projectId: p.id },
        data: fields,
      });
      if (res.count === 0) return fail('Pacote não encontrado neste projeto.');
      return json(
        serializePackageForAi(
          await prisma.creditPackage.findUniqueOrThrow({ where: { id: package_id } }),
        ),
      );
    }),
  );

  server.registerTool(
    'create_topup_pix',
    {
      title: 'Recarga Pix da organização',
      description:
        'Gera um Pix para colocar saldo na carteira da organização (uso próprio e híbrido). Devolve o copia e cola; o QR aparece também no painel (Carteira). Mínimo R$ 5,00.',
      inputSchema: {
        amount_brl: z.string().optional().describe('Valor em reais, ex.: "50.00"'),
        package_id: z.string().min(1).optional().describe('Ou um pacote global de recarga'),
      },
      annotations: { ...writes(), openWorldHint: true },
    },
    tool<{ amount_brl?: string; package_id?: string }>('create_topup_pix', async (args) => {
      if (!!args.amount_brl === !!args.package_id)
        return fail('Informe amount_brl ou package_id (só um).');
      let amountCents: number | undefined;
      if (args.amount_brl) {
        const micros = parseBrl(args.amount_brl);
        if (micros == null || micros % 10_000n !== 0n)
          return fail('Valor inválido. Use reais com até 2 casas, ex.: "50.00".');
        amountCents = Number(micros / 10_000n);
        if (amountCents < PIX_MIN_CENTS) return fail('O Pix tem mínimo de R$ 5,00.');
      }
      const payment = await createOrgTopup(prisma, deps.provider, await settings.get(), orgId, {
        ...(amountCents ? { amountCents } : { packageId: args.package_id }),
      });
      const { pixQrBase64: _qr, ...rest } = serializePayment(payment);
      return json({
        ...rest,
        valor: microsToBrl(BigInt(payment.amountCents) * 10_000n),
        onde_pagar: `${env.APP_URL}/app/carteira`,
        dica: 'Mostre o copia e cola ao usuário (ou o QR no painel). O saldo sobe sozinho quando o Pix cair; confira com get_balance.',
      });
    }),
  );

  server.registerTool(
    'adjust_end_user_credits',
    {
      title: 'Dar ou remover créditos de um usuário final',
      description:
        'Cortesia (valor positivo) ou correção (negativo) no saldo de um usuário final. Pede confirm.',
      inputSchema: {
        project: projectArg,
        externalId: z.string().min(1).max(128),
        amount_brl: z.string().describe('Ex.: "5.00" ou "-2.00"'),
        reason: z.string().trim().min(3).max(200),
        confirm: confirmArg,
      },
      annotations: writes(true),
    },
    tool<{
      project: string;
      externalId: string;
      amount_brl: string;
      reason: string;
      confirm?: boolean;
    }>('adjust_end_user_credits', async (args) => {
      const p = await findProject(args.project);
      const negative = args.amount_brl.trim().startsWith('-');
      const abs = parseBrl(args.amount_brl.trim().replace(/^[-+]/, ''));
      if (abs == null || abs === 0n) return fail('Valor inválido, ex.: "5.00" ou "-2.00".');
      if (abs > 1_000_000_000n) return fail('Máximo de R$ 1.000 por ajuste.');
      const amount = negative ? -abs : abs;
      const user = await prisma.appUser.findUnique({
        where: { projectId_externalId: { projectId: p.id, externalId: args.externalId } },
        include: { wallet: true },
      });
      if (!user?.wallet) return fail(`Usuário final "${args.externalId}" não encontrado.`);
      if (!args.confirm)
        return json({
          preview: {
            usuario: args.externalId,
            ajuste: microsToBrl(amount),
            saldo_atual: microsToBrl(user.wallet.balanceMicros),
            motivo: args.reason,
          },
          aplicado: false,
          instrucao: 'Confirme com o usuário e chame de novo com confirm: true.',
        });
      const walletId = user.wallet.id;
      const after = await prisma.$transaction(async (tx) => {
        const entry = await applyLedger(tx, {
          walletId,
          type: amount > 0n ? 'BONUS' : 'ADJUSTMENT',
          amountMicros: amount,
          referenceType: 'manual_adjustment',
          referenceId: randomUUID(),
          description: args.reason,
          actorId: ctx.actorId,
        });
        const w = await tx.wallet.findUniqueOrThrow({ where: { id: walletId } });
        if (amount < 0n && entry.balanceAfter - w.reservedMicros < 0n)
          throw new HttpError(400, 'insufficient_balance', 'O usuário não tem esse saldo.');
        return w;
      });
      await audit('adjust_end_user_credits.applied', p.id, {
        appUserId: user.id,
        amountMicros: amount.toString(),
      });
      return json({ aplicado: true, ...serializeAppUser(user, after) });
    }),
  );

  server.registerTool(
    'send_test_webhook',
    {
      title: 'Enviar webhook de teste',
      description: 'Envia um test.ping assinado para o webhook do projeto e devolve o resultado.',
      inputSchema: { project: projectArg },
      annotations: { ...writes(), openWorldHint: true },
    },
    tool<{ project: string }>('send_test_webhook', async (args) =>
      result(await sendTestWebhook(prisma, hookOpts, await findProject(args.project))),
    ),
  );

  // ---------------------------------------------------------------- prompts
  const prompt = (body: string) => ({
    messages: [{ role: 'user' as const, content: { type: 'text' as const, text: body } }],
  });
  server.registerPrompt(
    'configurar_uso_proprio',
    {
      title: 'Configurar fusai para uso próprio',
      description: 'O dono do sistema usa IA no próprio sistema e paga o consumo.',
      argsSchema: { stack: z.string().optional(), sistema: z.string().optional() },
    },
    ({ stack, sistema }) =>
      prompt(
        `Configure a fusai para USO PRÓPRIO${sistema ? ` no sistema "${sistema}"` : ''}. 1) get_account; 2) get_setup_guide com use_case "uso_proprio"; 3) crie o projeto (create_project) se não existir; 4) create_api_key e grave em FUSAI_API_KEY no .env do servidor (nunca versionar); 5) get_integration_guide${stack ? ` com stack "${stack}"` : ' com a stack deste código'} e implemente as chamadas de IA no backend; 6) se o saldo estiver baixo, ofereça create_topup_pix. Mostre um resumo do que foi feito no fim.`,
      ),
  );
  server.registerPrompt(
    'configurar_revenda',
    {
      title: 'Configurar fusai para revenda de créditos',
      description: 'Os clientes do sistema compram créditos com Pix e pagam o que usam.',
      argsSchema: { stack: z.string().optional(), sistema: z.string().optional() },
    },
    ({ stack, sistema }) =>
      prompt(
        `Configure a fusai para REVENDA${sistema ? ` no sistema "${sistema}"` : ''}: os usuários do sistema compram créditos com Pix dentro dele, veem o saldo e consomem a IA. 1) get_account; 2) get_setup_guide com use_case "revenda"; 3) create_project (use_case "revenda") se não existir; 4) proponha pacotes e crie com create_package após confirmação; 5) update_project_settings com a origem do front e a URL do webhook (com confirmação); 6) create_api_key e grave em FUSAI_API_KEY no .env do servidor; 7) get_integration_guide${stack ? ` com stack "${stack}"` : ' com a stack deste código'} e implemente: upsert do usuário final, rota de session token, saldo, compra Pix, chat e webhook com verificação de assinatura; 8) send_test_webhook. Mostre um resumo e o que o usuário precisa testar.`,
      ),
  );

  return server;
}
