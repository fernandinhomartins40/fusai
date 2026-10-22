import type { PrismaClient, UsageStatus } from '@fusai/db';
import type { ModelPrices, Settings } from '@fusai/shared';
import { settle, type Tx } from '../billing/wallet';
import type { GatewayContext } from './auth';
import type { CatalogEntry } from './catalog';
import { GatewayError } from './errors';
import { chargeFor, providerCost, type Usage } from './usage';

export const ZERO_USAGE: Usage = { prompt: 0, cached: 0, completion: 0, reasoning: 0 };

export type WalletTarget = {
  walletId: string;
  creditLimitMicros: bigint;
  owner: 'org' | 'app_user';
};

/** Who pays (PRD §5.3/§5.4): wallets to try in order, or nobody for INTERNAL organizations. */
export type Billing = { mode: 'internal' } | { mode: 'wallet'; candidates: WalletTarget[] };

export function resolveBilling(ctx: GatewayContext): Billing {
  if (ctx.org.billingType === 'INTERNAL') return { mode: 'internal' };
  if (!ctx.org.wallet)
    throw new GatewayError(500, 'wallet_missing', 'Carteira da organização não encontrada.');
  const org: WalletTarget = {
    walletId: ctx.org.wallet.id,
    creditLimitMicros: ctx.org.billingType === 'POSTPAID' ? ctx.org.creditLimitMicros : 0n,
    owner: 'org',
  };
  const user: WalletTarget | null = ctx.appUser?.wallet
    ? { walletId: ctx.appUser.wallet.id, creditLimitMicros: 0n, owner: 'app_user' }
    : null;

  switch (ctx.project.billingMode) {
    case 'ORG_WALLET':
      return { mode: 'wallet', candidates: [org] };
    case 'END_USER_WALLET':
      if (!user) {
        throw new GatewayError(
          400,
          'app_user_required',
          'Este projeto cobra do usuário final: use um session token ou envie o header X-Fuse-User.',
        );
      }
      return { mode: 'wallet', candidates: [user] };
    case 'HYBRID':
      // Freemium: the end user's credits first, the organization covers the rest.
      return { mode: 'wallet', candidates: user ? [user, org] : [org] };
  }
}

export function monthStartUtc(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/** Spent this month by a key (source of truth: UsageLog). */
export async function monthlySpend(prisma: PrismaClient, apiKeyId: string): Promise<bigint> {
  const agg = await prisma.usageLog.aggregate({
    where: { apiKeyId, createdAt: { gte: monthStartUtc() } },
    _sum: { chargedMicros: true },
  });
  return agg._sum.chargedMicros ?? 0n;
}

export type FinishInput = {
  entry: CatalogEntry;
  prices: ModelPrices;
  usage: Usage;
  status: UsageStatus;
  errorCode: string | null;
  latencyMs: number;
  ttftMs: number | null;
  stream: boolean;
};

/**
 * Settles the request on the wallet that was reserved (`target`; null = INTERNAL org):
 * charges the real usage or releases the hold, and writes the UsageLog in the same transaction.
 */
export async function finishRequest(
  prisma: PrismaClient,
  ctx: GatewayContext,
  target: WalletTarget | null,
  settings: Settings,
  usageId: string,
  input: FinishInput,
): Promise<bigint> {
  const charge = chargeFor(input.usage, input.prices);
  const cost = providerCost(input.usage, input.entry.model, settings.usd_brl_rate);
  const log = (tx: Tx | PrismaClient, charged = charge) =>
    tx.usageLog.create({
      data: {
        requestId: usageId,
        orgId: ctx.org.id,
        projectId: ctx.project.id,
        apiKeyId: ctx.spendKey?.id ?? null,
        appUserId: ctx.appUser?.id ?? null,
        walletId: target?.walletId ?? null,
        modelId: input.entry.model.id,
        providerId: input.entry.provider.id,
        promptTokens: input.usage.prompt,
        cachedTokens: input.usage.cached,
        completionTokens: input.usage.completion,
        reasoningTokens: input.usage.reasoning,
        costUsdMicros: cost.costUsdMicros,
        costBrlMicros: cost.costBrlMicros,
        chargedMicros: charged,
        latencyMs: input.latencyMs,
        ttftMs: input.ttftMs,
        stream: input.stream,
        status: input.status,
        // The balance ran out mid-request: only what was available was charged (D-128).
        errorCode:
          charged < charge
            ? [input.errorCode, 'charge_capped'].filter(Boolean).join(':')
            : input.errorCode,
      },
    });

  if (!target) {
    await log(prisma);
    return charge;
  }
  const result = await settle(prisma, {
    requestId: usageId,
    walletId: target.walletId,
    chargeMicros: charge,
    creditLimitMicros: target.creditLimitMicros,
    description: `${input.entry.model.slug} · ${input.usage.prompt} + ${input.usage.completion} tokens`,
    onSettled: (tx, charged) => log(tx, charged),
  });
  return result.charged;
}
