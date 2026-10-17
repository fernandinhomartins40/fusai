/**
 * Idempotent seed: super admin, internal organization, settings, providers (disabled),
 * example models (inactive, prices to be verified) and global credit packages.
 * Running it again never overwrites values the admin changed.
 */
import { randomBytes } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { hashPassword } from 'better-auth/crypto';

const prisma = new PrismaClient();

const BRL = 1_000_000n;
const VERIFY = 'Preço de exemplo — verificar na página oficial do provedor antes de ativar.';

const settings: Record<string, unknown> = {
  usd_brl_rate: '5.50',
  default_markup: '4.0',
  topup_fee_pct: '0',
  min_topup_cents: 500,
  low_balance_threshold_micros: '5000000',
  welcome_bonus_micros: '0',
  test_key_max_output_micros: '50000000',
};

const providers = [
  { slug: 'deepseek', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', priority: 10 },
  {
    slug: 'moonshot',
    name: 'Moonshot (Kimi)',
    baseUrl: 'https://api.moonshot.ai/v1',
    priority: 20,
  },
  {
    slug: 'zhipu',
    name: 'Zhipu / Z.ai (GLM)',
    baseUrl: 'https://api.z.ai/api/paas/v4',
    priority: 30,
  },
  {
    slug: 'qwen',
    name: 'Alibaba Cloud Model Studio (Qwen)',
    baseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
    priority: 40,
  },
  { slug: 'minimax', name: 'MiniMax', baseUrl: 'https://api.minimax.io/v1', priority: 50 },
  {
    slug: 'openrouter',
    name: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    priority: 900,
  },
];

type ModelSeed = {
  slug: string;
  displayName: string;
  provider: string;
  upstreamModel: string;
  contextWindow: number;
  maxOutputTokens?: number;
  input: string;
  cachedInput?: string;
  output: string;
  tools?: boolean;
  reasoning?: boolean;
};

// USD per 1M tokens. EXAMPLE VALUES ONLY — the admin must confirm on each provider's site.
const models: ModelSeed[] = [
  {
    slug: 'fuse/deepseek-chat',
    displayName: 'DeepSeek Chat',
    provider: 'deepseek',
    upstreamModel: 'deepseek-chat',
    contextWindow: 128_000,
    input: '0.27',
    cachedInput: '0.07',
    output: '1.10',
    tools: true,
  },
  {
    slug: 'fuse/deepseek-reasoner',
    displayName: 'DeepSeek Reasoner',
    provider: 'deepseek',
    upstreamModel: 'deepseek-reasoner',
    contextWindow: 128_000,
    maxOutputTokens: 32_768,
    input: '0.55',
    cachedInput: '0.14',
    output: '2.19',
    reasoning: true,
  },
  {
    slug: 'fuse/kimi-k2',
    displayName: 'Kimi K2',
    provider: 'moonshot',
    upstreamModel: 'kimi-k2-0905-preview',
    contextWindow: 256_000,
    input: '0.60',
    cachedInput: '0.15',
    output: '2.50',
    tools: true,
  },
  {
    slug: 'fuse/glm-4.6',
    displayName: 'GLM 4.6',
    provider: 'zhipu',
    upstreamModel: 'glm-4.6',
    contextWindow: 200_000,
    input: '0.60',
    cachedInput: '0.11',
    output: '2.20',
    tools: true,
    reasoning: true,
  },
  {
    slug: 'fuse/qwen-plus',
    displayName: 'Qwen Plus',
    provider: 'qwen',
    upstreamModel: 'qwen-plus',
    contextWindow: 131_072,
    input: '0.40',
    output: '1.20',
    tools: true,
  },
  {
    slug: 'fuse/minimax-m2',
    displayName: 'MiniMax M2',
    provider: 'minimax',
    upstreamModel: 'MiniMax-M2',
    contextWindow: 204_800,
    input: '0.30',
    output: '1.20',
    tools: true,
    reasoning: true,
  },
];

const packages = [
  { name: 'R$ 20', priceCents: 2_000, creditMicros: 20n * BRL, bonusMicros: 0n, sortOrder: 1 },
  {
    name: 'R$ 50',
    priceCents: 5_000,
    creditMicros: 50n * BRL,
    bonusMicros: 2_500_000n,
    sortOrder: 2,
  },
  {
    name: 'R$ 100',
    priceCents: 10_000,
    creditMicros: 100n * BRL,
    bonusMicros: 10n * BRL,
    sortOrder: 3,
    highlight: true,
  },
  {
    name: 'R$ 300',
    priceCents: 30_000,
    creditMicros: 300n * BRL,
    bonusMicros: 45n * BRL,
    sortOrder: 4,
  },
];

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name} in .env`);
  return value;
}

async function seedAdmin() {
  const email = requireEnv('SEED_ADMIN_EMAIL').toLowerCase();
  const password = requireEnv('SEED_ADMIN_PASSWORD');
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    await prisma.user.update({ where: { id: existing.id }, data: { role: 'SUPER_ADMIN' } });
    return existing.id;
  }
  const id = randomBytes(16).toString('hex');
  await prisma.user.create({
    data: {
      id,
      email,
      name: 'Admin fusai',
      emailVerified: true,
      role: 'SUPER_ADMIN',
      accounts: {
        create: {
          id: randomBytes(16).toString('hex'),
          accountId: id,
          providerId: 'credential',
          password: await hashPassword(password),
        },
      },
    },
  });
  return id;
}

async function seedInternalOrg(adminId: string) {
  const org = await prisma.organization.upsert({
    where: { slug: 'fuseai-interno' },
    update: {},
    create: {
      name: 'fusai Interno',
      slug: 'fuseai-interno',
      billingType: 'INTERNAL',
      wallet: { create: { ownerType: 'ORGANIZATION' } },
    },
  });
  await prisma.membership.upsert({
    where: { userId_orgId: { userId: adminId, orgId: org.id } },
    update: {},
    create: { userId: adminId, orgId: org.id, role: 'OWNER' },
  });
}

async function seedCatalog() {
  for (const [key, value] of Object.entries(settings)) {
    await prisma.setting.upsert({
      where: { key },
      update: {},
      create: { key, value: value as never },
    });
  }

  const providerIds = new Map<string, string>();
  for (const p of providers) {
    const row = await prisma.provider.upsert({
      where: { slug: p.slug },
      update: {},
      create: { ...p, apiKeyEnc: '', status: 'DISABLED' },
    });
    providerIds.set(p.slug, row.id);
  }

  for (const [index, m] of models.entries()) {
    const providerId = providerIds.get(m.provider);
    if (!providerId) throw new Error(`Unknown provider ${m.provider}`);
    await prisma.model.upsert({
      where: { slug: m.slug },
      update: {},
      create: {
        slug: m.slug,
        displayName: m.displayName,
        description: VERIFY,
        providerId,
        upstreamModel: m.upstreamModel,
        contextWindow: m.contextWindow,
        maxOutputTokens: m.maxOutputTokens ?? 8192,
        inputCostUsdPerM: m.input,
        cachedInputCostUsdPerM: m.cachedInput ?? null,
        outputCostUsdPerM: m.output,
        supportsTools: m.tools ?? false,
        supportsReasoning: m.reasoning ?? false,
        active: false,
        sortOrder: index,
      },
    });
  }

  for (const pkg of packages) {
    const exists = await prisma.creditPackage.findFirst({
      where: { projectId: null, name: pkg.name },
    });
    if (!exists) await prisma.creditPackage.create({ data: pkg });
  }
}

async function main() {
  const adminId = await seedAdmin();
  await seedInternalOrg(adminId);
  await seedCatalog();
  console.log('Seed complete.');
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
