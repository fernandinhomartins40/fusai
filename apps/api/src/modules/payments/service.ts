import { randomUUID } from 'node:crypto';
import { type Payment, Prisma, type PrismaClient } from '@fuseai/db';
import { ceilDiv, centsToMicros, formatBRL, mulDecimalsCeil, type Settings } from '@fuseai/shared';
import { HttpError } from '../../lib/errors';
import type { NormalizedPaymentEvent, PaymentProvider } from '../../payments/types';
import { applyLedger } from '../billing/wallet';

/** How long a Pix QR code stays payable on our side (the job then cancels it at Asaas). */
export const PIX_TTL_MS = 60 * 60 * 1000;
/** Upper bound for a single top-up (typo guard; Pix itself allows more). */
export const MAX_TOPUP_CENTS = 1_000_000; // R$ 10.000

export type PaymentMeta = {
  baseMicros: string;
  bonusMicros: string;
  feeCents: number;
  packageName?: string;
};

/** Amount to charge for `baseCents` of credits plus the optional top-up fee: ⌈base × pct / 100⌉. */
export function amountWithFee(
  baseCents: number,
  feePct: string,
): { amountCents: number; feeCents: number } {
  const feeCents = Number(ceilDiv(mulDecimalsCeil([String(baseCents), feePct], 1n), 100n));
  return { amountCents: baseCents + feeCents, feeCents };
}

export function serializePayment(p: Payment) {
  const meta = (p.metadata ?? {}) as Partial<PaymentMeta>;
  return {
    id: p.id,
    status: p.status,
    amountCents: p.amountCents,
    creditMicros: p.creditMicros.toString(),
    bonusMicros: meta.bonusMicros ?? '0',
    feeCents: meta.feeCents ?? 0,
    packageName: meta.packageName ?? null,
    pixCopyPaste: p.status === 'PENDING' ? p.pixCopyPaste : null,
    pixQrBase64: p.status === 'PENDING' ? p.pixQrBase64 : null,
    expiresAt: p.expiresAt?.toISOString() ?? null,
    paidAt: p.paidAt?.toISOString() ?? null,
    creditedAt: p.creditedAt?.toISOString() ?? null,
    createdAt: p.createdAt.toISOString(),
  };
}

type TopupInput = { packageId?: string; amountCents?: number; idempotencyKey?: string };

/** Creates an organization top-up: customer at the PSP, Pix charge and QR code (PRD §9.1 steps 1-4). */
export async function createOrgTopup(
  prisma: PrismaClient,
  provider: PaymentProvider,
  settings: Settings,
  orgId: string,
  input: TopupInput,
) {
  const org = await prisma.organization.findUniqueOrThrow({
    where: { id: orgId },
    include: { wallet: true },
  });
  if (org.billingType === 'INTERNAL')
    throw new HttpError(400, 'internal_org', 'Organizações internas não têm cobrança.');
  if (!org.document) {
    throw new HttpError(
      400,
      'document_required',
      'Cadastre o CPF ou CNPJ da organização em Configurações.',
    );
  }
  if (!org.wallet) throw new HttpError(500, 'wallet_missing', 'Carteira não encontrada');

  const idempotencyKey = `org:${org.id}:${input.idempotencyKey ?? randomUUID()}`;
  const existing = await prisma.payment.findUnique({ where: { idempotencyKey } });
  if (existing) return existing;

  let baseCents: number;
  let bonusMicros = 0n;
  let packageName: string | undefined;
  if (input.packageId) {
    const pkg = await prisma.creditPackage.findFirst({
      where: { id: input.packageId, projectId: null, active: true },
    });
    if (!pkg) throw new HttpError(404, 'package_not_found', 'Pacote não encontrado');
    baseCents = pkg.priceCents;
    bonusMicros = pkg.bonusMicros;
    packageName = pkg.name;
  } else {
    baseCents = input.amountCents ?? 0;
    if (baseCents < settings.min_topup_cents) {
      throw new HttpError(
        400,
        'amount_too_low',
        `A recarga mínima é ${formatBRL(centsToMicros(settings.min_topup_cents))}.`,
      );
    }
    if (baseCents > MAX_TOPUP_CENTS) {
      throw new HttpError(
        400,
        'amount_too_high',
        `A recarga máxima é ${formatBRL(centsToMicros(MAX_TOPUP_CENTS))}.`,
      );
    }
  }
  const { amountCents, feeCents } = amountWithFee(baseCents, settings.topup_fee_pct);
  const baseMicros = centsToMicros(baseCents);

  let customerId = org.asaasCustomerId;
  if (!customerId) {
    customerId = await provider.ensureCustomer({
      name: org.name,
      document: org.document,
      externalRef: `org:${org.id}`,
    });
    await prisma.organization.update({
      where: { id: org.id },
      data: { asaasCustomerId: customerId },
    });
  }

  const payment = await prisma.payment.create({
    data: {
      walletId: org.wallet.id,
      orgId: org.id,
      packageId: input.packageId ?? null,
      providerCustomerId: customerId,
      amountCents,
      creditMicros: baseMicros + bonusMicros,
      idempotencyKey,
      metadata: {
        baseMicros: baseMicros.toString(),
        bonusMicros: bonusMicros.toString(),
        feeCents,
        ...(packageName ? { packageName } : {}),
      } satisfies PaymentMeta,
    },
  });

  try {
    const { providerPaymentId } = await provider.createPixCharge({
      customerId,
      amountCents,
      description: `FuseAI: ${formatBRL(baseMicros + bonusMicros)} em créditos (${org.name})`,
      externalRef: payment.id,
      dueDate: new Date(),
    });
    const qr = await provider.getPixQrCode(providerPaymentId);
    const ourExpiry = new Date(Date.now() + PIX_TTL_MS);
    return await prisma.payment.update({
      where: { id: payment.id },
      data: {
        providerPaymentId,
        pixCopyPaste: qr.copyPaste,
        pixQrBase64: qr.qrBase64,
        expiresAt: qr.expiresAt < ourExpiry ? qr.expiresAt : ourExpiry,
      },
    });
  } catch (err) {
    await prisma.payment.update({ where: { id: payment.id }, data: { status: 'FAILED' } });
    throw err;
  }
}

export type CreditResult = { credited: boolean; reason?: string; payment?: Payment };

/**
 * Credits a paid payment exactly once (PRD §9.1 step 6). The guard is `creditedAt IS NULL`
 * in a conditional update, plus the unique ledger key (PURCHASE/BONUS per payment).
 * Confirms with the PSP first: a webhook body alone is never trusted.
 */
export async function creditPayment(
  prisma: PrismaClient,
  provider: PaymentProvider,
  paymentId: string,
): Promise<CreditResult> {
  const payment = await prisma.payment.findUnique({ where: { id: paymentId } });
  if (!payment?.providerPaymentId) return { credited: false, reason: 'unknown_payment' };
  if (payment.creditedAt) return { credited: false, reason: 'already_credited', payment };

  const remote = await provider.getPayment(payment.providerPaymentId);
  if (remote.status !== 'RECEIVED' && remote.status !== 'CONFIRMED') {
    return { credited: false, reason: `not_paid:${remote.status}`, payment };
  }
  if (remote.valueCents !== payment.amountCents) {
    return { credited: false, reason: `amount_mismatch:${remote.valueCents}`, payment };
  }

  const meta = (payment.metadata ?? {}) as Partial<PaymentMeta>;
  const base = BigInt(meta.baseMicros ?? payment.creditMicros.toString());
  const bonus = BigInt(meta.bonusMicros ?? '0');

  try {
    const updated = await prisma.$transaction(async (tx) => {
      const claimed = await tx.payment.updateMany({
        where: { id: payment.id, creditedAt: null },
        data: { status: 'RECEIVED', paidAt: payment.paidAt ?? new Date(), creditedAt: new Date() },
      });
      if (claimed.count === 0) return null; // a concurrent worker credited it
      const ref = { referenceType: 'payment', referenceId: payment.id };
      await applyLedger(tx, {
        walletId: payment.walletId,
        type: 'PURCHASE',
        amountMicros: base,
        description: `Recarga via Pix (${formatBRL(centsToMicros(payment.amountCents))})`,
        ...ref,
      });
      if (bonus > 0n) {
        await applyLedger(tx, {
          walletId: payment.walletId,
          type: 'BONUS',
          amountMicros: bonus,
          description: 'Bônus do pacote',
          ...ref,
        });
      }
      return tx.payment.findUniqueOrThrow({ where: { id: payment.id } });
    });
    return updated
      ? { credited: true, payment: updated }
      : { credited: false, reason: 'already_credited', payment };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return { credited: false, reason: 'already_credited', payment };
    }
    throw err;
  }
}

/** Refund received at the PSP: debits what was credited (may leave the wallet negative, PRD §9.1 step 8). */
export async function applyRefund(prisma: PrismaClient, paymentId: string): Promise<boolean> {
  const payment = await prisma.payment.findUnique({ where: { id: paymentId } });
  if (!payment?.creditedAt || payment.status === 'REFUNDED') return false;
  try {
    await prisma.$transaction(async (tx) => {
      const claimed = await tx.payment.updateMany({
        where: { id: payment.id, status: { not: 'REFUNDED' } },
        data: { status: 'REFUNDED' },
      });
      if (claimed.count === 0) return;
      await applyLedger(tx, {
        walletId: payment.walletId,
        type: 'REFUND',
        amountMicros: -payment.creditMicros,
        referenceType: 'payment',
        referenceId: payment.id,
        description: 'Estorno da recarga via Pix',
      });
    });
    return true;
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return false;
    throw err;
  }
}

/** Resolves our Payment from a webhook (externalReference = our payment id, else the PSP id). */
async function findPaymentForEvent(prisma: PrismaClient, event: NormalizedPaymentEvent) {
  if (event.externalRef) {
    const byRef = await prisma.payment.findUnique({ where: { id: event.externalRef } });
    if (byRef && (!event.providerPaymentId || byRef.providerPaymentId === event.providerPaymentId))
      return byRef;
  }
  return event.providerPaymentId
    ? prisma.payment.findUnique({ where: { providerPaymentId: event.providerPaymentId } })
    : null;
}

export type ProcessHooks = { onCredited?: (payment: Payment) => Promise<void> };

/** Processes one stored webhook event (idempotent: safe to run many times). */
export async function processWebhookEvent(
  prisma: PrismaClient,
  provider: PaymentProvider,
  eventId: string,
  hooks: ProcessHooks = {},
) {
  const stored = await prisma.inboundWebhookEvent.findUnique({ where: { id: eventId } });
  if (!stored || stored.processedAt) return;
  const event = stored.payload as unknown as NormalizedPaymentEvent & { raw?: unknown };
  let error: string | null = null;
  try {
    const payment = await findPaymentForEvent(prisma, event);
    if (!payment) {
      error = 'payment_not_found';
    } else if (event.kind === 'paid') {
      const result = await creditPayment(prisma, provider, payment.id);
      if (result.credited && result.payment)
        await hooks.onCredited?.(result.payment).catch(() => {});
      if (!result.credited && result.reason !== 'already_credited')
        error = result.reason ?? 'not_credited';
    } else if (event.kind === 'refunded') {
      await applyRefund(prisma, payment.id);
    } else if (event.kind === 'expired') {
      await prisma.payment.updateMany({
        where: { id: payment.id, status: 'PENDING', creditedAt: null },
        data: { status: event.type === 'PAYMENT_DELETED' ? 'CANCELED' : 'EXPIRED' },
      });
    }
  } catch (err) {
    // Leave it unprocessed: the sweep retries it later.
    await prisma.inboundWebhookEvent.update({
      where: { id: stored.id },
      data: { error: err instanceof Error ? err.message.slice(0, 500) : 'error' },
    });
    throw err;
  }
  await prisma.inboundWebhookEvent.update({
    where: { id: stored.id },
    data: { processedAt: new Date(), error },
  });
}

/** Retries events that were stored but not processed (enqueue failed, worker down, PSP error). */
export async function processPendingWebhookEvents(
  prisma: PrismaClient,
  provider: PaymentProvider,
  hooks: ProcessHooks = {},
  olderThanMs = 0,
) {
  const pending = await prisma.inboundWebhookEvent.findMany({
    where: { processedAt: null, createdAt: { lte: new Date(Date.now() - olderThanMs) } },
    orderBy: { createdAt: 'asc' },
    take: 100,
  });
  for (const e of pending) await processWebhookEvent(prisma, provider, e.id, hooks).catch(() => {});
  return pending.length;
}

/** Expires unpaid Pix charges past their deadline and cancels them at the PSP (PRD §9.1 step 9). */
export async function expirePendingPayments(prisma: PrismaClient, provider: PaymentProvider) {
  const due = await prisma.payment.findMany({
    where: { status: 'PENDING', creditedAt: null, expiresAt: { lt: new Date() } },
    take: 100,
  });
  let expired = 0;
  for (const p of due) {
    if (p.providerPaymentId) {
      try {
        const remote = await provider.getPayment(p.providerPaymentId);
        if (remote.status === 'RECEIVED' || remote.status === 'CONFIRMED') {
          await creditPayment(prisma, provider, p.id); // paid but the webhook has not arrived yet
          continue;
        }
        await provider.cancel(p.providerPaymentId);
      } catch {
        continue; // try again on the next run
      }
    }
    const res = await prisma.payment.updateMany({
      where: { id: p.id, status: 'PENDING', creditedAt: null },
      data: { status: 'EXPIRED' },
    });
    expired += res.count;
  }
  return expired;
}
