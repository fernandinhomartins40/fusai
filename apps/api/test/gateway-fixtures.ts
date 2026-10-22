import { prisma } from '@fusai/db';
import { encryptSecret, parseEncryptionKey } from '../src/lib/crypto';
import type { Env } from '../src/lib/env';
import { generateApiKey, hashApiKey, keyDisplayPrefix } from '../src/modules/api-keys/keys';
import { createFundedOrg } from './helpers';

export const FAKE_PROVIDER_KEY = 'sk-fake-provider-key-1234567890';

type ModelSpec = {
  slug: string;
  upstream: string;
  provider?: 'main' | 'backup';
  outputUsd?: string;
  fallbacks?: string[];
  maxOutputTokens?: number;
};

const MODELS: ModelSpec[] = [
  { slug: 'fuse/echo', upstream: 'echo' },
  { slug: 'fuse/echo-backup', upstream: 'echo', provider: 'backup' },
  { slug: 'fuse/fail', upstream: 'fail-500', fallbacks: ['fuse/echo-backup'] },
  { slug: 'fuse/bad', upstream: 'bad-request' },
  { slug: 'fuse/no-usage', upstream: 'no-usage' },
  { slug: 'fuse/slow', upstream: 'slow' },
  { slug: 'fuse/pricey', upstream: 'echo', outputUsd: '10' },
];

/** Prices with default settings (rate 5.50, markup 4): input R$ 5,50/1M, output R$ 22,00/1M. */
export const ECHO_CHARGE = (12n * 5_500_000n) / 1_000_000n + (8n * 22_000_000n) / 1_000_000n; // 66 + 176 = 242

export async function setupGateway(
  env: Env,
  baseUrl: string,
  opts: {
    balanceMicros?: bigint;
    billingType?: 'PREPAID' | 'POSTPAID' | 'INTERNAL';
    keyEnv?: 'LIVE' | 'TEST';
    rpmLimit?: number;
    spendLimitMicros?: bigint;
    scopes?: string[];
    allowedSlugs?: string[];
    /** Makes the key's creator a real member with this role (default: no membership). */
    keyCreatorRole?: 'OWNER' | 'ADMIN' | 'DEVELOPER' | 'BILLING';
  } = {},
) {
  const encKey = parseEncryptionKey(env.ENCRYPTION_KEY);
  const apiKeyEnc = encryptSecret(FAKE_PROVIDER_KEY, encKey);
  const main = await prisma.provider.create({
    data: { slug: 'main', name: 'Main', baseUrl, apiKeyEnc, status: 'ACTIVE', priority: 1 },
  });
  const backup = await prisma.provider.create({
    data: { slug: 'backup', name: 'Backup', baseUrl, apiKeyEnc, status: 'ACTIVE', priority: 2 },
  });

  const ids = new Map<string, string>();
  for (const m of MODELS) {
    const row = await prisma.model.create({
      data: {
        slug: m.slug,
        displayName: m.slug,
        providerId: m.provider === 'backup' ? backup.id : main.id,
        upstreamModel: m.upstream,
        contextWindow: 128_000,
        maxOutputTokens: m.maxOutputTokens ?? 8192,
        inputCostUsdPerM: '0.25',
        outputCostUsdPerM: m.outputUsd ?? '1.00',
        active: true,
      },
    });
    ids.set(m.slug, row.id);
  }
  for (const m of MODELS) {
    if (!m.fallbacks) continue;
    await prisma.model.update({
      where: { slug: m.slug },
      data: { fallbackModelIds: m.fallbacks.map((s) => ids.get(s) as string) },
    });
  }

  const { org, walletId } = await createFundedOrg({
    balanceMicros: opts.balanceMicros ?? 10_000_000n,
    billingType: opts.billingType,
  });
  const project = await prisma.project.create({
    data: {
      orgId: org.id,
      name: 'App',
      slug: 'app',
      allowedModelIds: (opts.allowedSlugs ?? []).map((s) => ids.get(s) as string),
    },
  });
  let createdById = 'test';
  if (opts.keyCreatorRole) {
    const user = await prisma.user.create({
      data: { id: `creator-${org.id}`, name: 'Criador', email: `creator-${org.id}@teste.local` },
    });
    await prisma.membership.create({
      data: { userId: user.id, orgId: org.id, role: opts.keyCreatorRole },
    });
    createdById = user.id;
  }
  const plain = generateApiKey(opts.keyEnv ?? 'LIVE');
  const key = await prisma.apiKey.create({
    data: {
      projectId: project.id,
      name: 'teste',
      env: opts.keyEnv ?? 'LIVE',
      prefix: keyDisplayPrefix(plain),
      hash: hashApiKey(plain, env.KEY_PEPPER),
      scopes: opts.scopes ?? ['chat', 'billing:read', 'checkout', 'app_users', 'mcp'],
      rpmLimit: opts.rpmLimit ?? null,
      spendLimitMicros: opts.spendLimitMicros ?? null,
      createdById,
    },
  });
  return { org, walletId, project, key, plain, modelIds: ids, providers: { main, backup } };
}
