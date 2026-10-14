import type { PrismaClient, UsageStatus } from '@fuseai/db';
import type { ModelPrices, Settings } from '@fuseai/shared';
import { settle, type Tx } from '../billing/wallet';
import type { GatewayContext } from './auth';
import type { CatalogEntry } from './catalog';
import { GatewayError } from './errors';
import { chargeFor, providerCost, type Usage } from './usage';

export const ZERO_USAGE: Usage = { prompt: 0, cached: 0, completion: 0, reasoning: 0 };

/** Who pays for a request (PRD §5.3/§5.4). */
export type Billing =
  | { mode: 'internal' }
  | { mode: 'wallet'; walletId: string; creditLimitMicros: bigint };

export function resolveBilling(ctx: GatewayContext): Billing {
  if (ctx.org.billingType === 'INTERNAL') return { mode: 'internal' };
  if (ctx.project.billingMode === 'END_USER_WALLET') {
    // End-user wallets (X-Fuse-User / session tokens) arrive in Phase 7.
    throw new GatewayError(
      400,
      'app_user_required',
      'Este projeto cobra do usuário final: a identificação do usuário (X-Fuse-User) ainda não está disponível.',
    );
  }
  if (!ctx.org.wallet)
    throw new GatewayError(500, 'wallet_missing', 'Carteira da organização não encontrada.');
  return {
    mode: 'wallet',
    walletId: ctx.org.wallet.id,
    creditLimitMicros: ctx.org.billingType === 'POSTPAID' ? ctx.org.creditLimitMicros : 0n,
  };
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
 * Settles the request: charges the real usage (or releases the hold) and writes the UsageLog in
 * the same transaction. INTERNAL organizations only get the log, with a virtual charge.
 */
export async function finishRequest(
  prisma: PrismaClient,
  ctx: GatewayContext,
  billing: Billing,
  settings: Settings,
  usageId: string,
  input: FinishInput,
): Promise<bigint> {
  const charge = chargeFor(input.usage, input.prices);
  const cost = providerCost(input.usage, input.entry.model, settings.usd_brl_rate);
  const log = (tx: Tx | PrismaClient) =>
    tx.usageLog.create({
      data: {
        requestId: usageId,
        orgId: ctx.org.id,
        projectId: ctx.project.id,
        apiKeyId: ctx.key.id,
        walletId: billing.mode === 'wallet' ? billing.walletId : null,
        modelId: input.entry.model.id,
        providerId: input.entry.provider.id,
        promptTokens: input.usage.prompt,
        cachedTokens: input.usage.cached,
        completionTokens: input.usage.completion,
        reasoningTokens: input.usage.reasoning,
        costUsdMicros: cost.costUsdMicros,
        costBrlMicros: cost.costBrlMicros,
        chargedMicros: charge,
        latencyMs: input.latencyMs,
        ttftMs: input.ttftMs,
        stream: input.stream,
        status: input.status,
        errorCode: input.errorCode,
      },
    });

  if (billing.mode === 'internal') {
    await log(prisma);
    return charge;
  }
  await settle(prisma, {
    requestId: usageId,
    walletId: billing.walletId,
    chargeMicros: charge,
    description: `${input.entry.model.slug} · ${input.usage.prompt} + ${input.usage.completion} tokens`,
    onSettled: log,
  });
  return charge;
}
