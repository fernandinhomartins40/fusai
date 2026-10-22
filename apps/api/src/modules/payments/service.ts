import { randomBytes, randomUUID } from 'node:crypto';
import {
  type AppUser,
  type Organization,
  type Payment,
  Prisma,
  type PrismaClient,
  type Project,
  type Wallet,
} from '@fusai/db';
import {
  ceilDiv,
  centsToMicros,
  formatBRL,
  isValidDocument,
  mulDecimalsCeil,
  onlyDigits,
  PIX_MIN_CENTS,
  type Settings,
} from '@fusai/shared';
import { HttpError } from '../../lib/errors';
import type { NormalizedPaymentEvent, PaymentProvider } from '../../payments/types';
import { giveEndUserCredit } from '../app-users/service';
import { applyLedger, type Tx } from '../billing/wallet';
import { emitEvent } from '../webhooks-out/service';

/** How long a Pix QR code stays payable on our side (the job then cancels it at Asaas). */
export const PIX_TTL_MS = 60 * 60 * 1000;
/** Upper bound for a single top-up (typo guard; Pix itself allows more). */
export const MAX_TOPUP_CENTS = 1_000_000; // R$ 10.000

/** Global minimum, never below what the Asaas accepts for Pix (an old setting may be lower). */
export function minTopupCents(settings: Pick<Settings, 'min_topup_cents'>): number {
  return Math.max(settings.min_topup_cents, PIX_MIN_CENTS);
}

export type PaymentMeta = {
  baseMicros: string;
  bonusMicros: string;
  feeCents: number;
  packageName?: string;
  returnUrl?: string;
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
    checkoutId: p.publicId,
    pixCopyPaste: p.status === 'PENDING' ? p.pixCopyPaste : null,
    pixQrBase64: p.status === 'PENDING' ? p.pixQrBase64 : null,
    expiresAt: p.expiresAt?.toISOString() ?? null,
    paidAt: p.paidAt?.toISOString() ?? null,
    creditedAt: p.creditedAt?.toISOString() ?? null,
    createdAt: p.createdAt.toISOString(),
  };
}

type TopupInput = {
  packageId?: string;
  amountCents?: number;
  idempotencyKey?: string;
  /** Hosted page "Voltar" button (https or app deep link), already validated. */
  returnUrl?: string;
};

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
    const minCents = minTopupCents(settings);
    if (baseCents < minCents) {
      throw new HttpError(
        400,
        'amount_too_low',
        `A recarga mínima é ${formatBRL(centsToMicros(minCents))}.`,
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
      // Also payable on the hosted page /pay/{publicId} (e.g. opened from the customer's app).
      publicId: `chk_${randomBytes(18).toString('base64url')}`,
      metadata: {
        baseMicros: baseMicros.toString(),
        bonusMicros: bonusMicros.toString(),
        feeCents,
        ...(packageName ? { packageName } : {}),
        ...(input.returnUrl ? { returnUrl: input.returnUrl } : {}),
      } satisfies PaymentMeta,
    },
  });

  return issuePix(
    prisma,
    provider,
    payment,
    customerId,
    `fusai: ${formatBRL(baseMicros + bonusMicros)} em créditos (${org.name})`,
  );
}

/** Creates the Pix charge + QR code at the PSP for a stored payment (FAILED if the PSP errors). */
async function issuePix(
  prisma: PrismaClient,
  provider: PaymentProvider,
  payment: Payment,
  customerId: string,
  description: string,
) {
  try {
    const { providerPaymentId } = await provider.createPixCharge({
      customerId,
      amountCents: payment.amountCents,
      description,
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

export type CheckoutInput = {
  packageId: string;
  returnUrl?: string;
  name?: string;
  document?: string;
  email?: string;
  idempotencyKey?: string;
};

/**
 * An end user buys one of the project's credit packages (PRD §9.3). The payment credits the
 * APP_USER wallet; `publicId` (random, unguessable) identifies the hosted checkout `/pay/{publicId}`.
 * No top-up fee here: the customer sets the price of its own packages.
 */
export async function createAppUserCheckout(
  prisma: PrismaClient,
  provider: PaymentProvider,
  project: Project & { org: Organization },
  appUser: AppUser & { wallet: Wallet | null },
  input: CheckoutInput,
) {
  if (project.org.billingType === 'INTERNAL') {
    throw new HttpError(400, 'internal_org', 'Organizações internas não vendem créditos.');
  }
  if (!appUser.wallet)
    throw new HttpError(500, 'wallet_missing', 'Carteira do usuário não encontrada');
  const pkg = await prisma.creditPackage.findFirst({
    where: { id: input.packageId, projectId: project.id, active: true },
  });
  if (!pkg) throw new HttpError(404, 'package_not_found', 'Pacote não encontrado neste projeto');

  const idempotencyKey = `app_user:${appUser.id}:${input.idempotencyKey ?? randomUUID()}`;
  const existing = await prisma.payment.findUnique({ where: { idempotencyKey } });
  if (existing) return existing;

  // The PSP needs the buyer's name + CPF/CNPJ: from this request or from the app user.
  const document = input.document ? onlyDigits(input.document) : appUser.document;
  if (!document || !isValidDocument(document)) {
    throw new HttpError(
      400,
      'document_required',
      'Informe um CPF ou CNPJ válido do comprador (campo document).',
    );
  }
  const name = input.name?.trim() || appUser.name || `Cliente ${appUser.externalId}`;
  let customerId = document === appUser.document ? appUser.asaasCustomerId : null;
  if (!customerId) {
    customerId = await provider.ensureCustomer({
      name,
      document,
      email: input.email ?? appUser.email ?? undefined,
      externalRef: `app_user:${appUser.id}`,
    });
  }
  await prisma.appUser.update({
    where: { id: appUser.id },
    data: {
      document,
      name,
      asaasCustomerId: customerId,
      ...(input.email ? { email: input.email } : {}),
    },
  });

  const payment = await prisma.payment.create({
    data: {
      walletId: appUser.wallet.id,
      orgId: project.orgId,
      projectId: project.id,
      appUserId: appUser.id,
      packageId: pkg.id,
      providerCustomerId: customerId,
      amountCents: pkg.priceCents,
      creditMicros: pkg.creditMicros + pkg.bonusMicros,
      idempotencyKey,
      publicId: `chk_${randomBytes(18).toString('base64url')}`,
      metadata: {
        baseMicros: pkg.creditMicros.toString(),
        bonusMicros: pkg.bonusMicros.toString(),
        feeCents: 0,
        packageName: pkg.name,
        ...(input.returnUrl ? { returnUrl: input.returnUrl } : {}),
      } satisfies PaymentMeta,
    },
  });
  return issuePix(prisma, provider, payment, customerId, `${pkg.name} (${project.name})`);
}

/** Customer-facing webhook data for a payment (camelCase, like the /v1 checkout API). */
async function paymentEventData(
  tx: Prisma.TransactionClient,
  payment: Payment,
  extra: Record<string, unknown> = {},
) {
  const appUser = payment.appUserId
    ? await tx.appUser.findUnique({ where: { id: payment.appUserId }, include: { wallet: true } })
    : null;
  return {
    payment: {
      id: payment.id,
      checkoutId: payment.publicId,
      status: payment.status,
      amountCents: payment.amountCents,
      creditMicros: payment.creditMicros.toString(),
      packageId: payment.packageId,
    },
    ...extra,
    ...(appUser
      ? {
          appUser: {
            id: appUser.id,
            externalId: appUser.externalId,
            balanceMicros: (appUser.wallet?.balanceMicros ?? 0n).toString(),
          },
        }
      : {}),
  };
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
  let base = BigInt(meta.baseMicros ?? payment.creditMicros.toString());
  let bonus = BigInt(meta.bonusMicros ?? '0');
  // PIE R-01: an end user's purchase buys at most what was paid. Anything above (the package
  // bonus, or credits of an older package priced below them) is paid by the organization.
  if (payment.appUserId) {
    const paid = centsToMicros(payment.amountCents);
    if (base > paid) {
      bonus += base - paid;
      base = paid;
    }
  }

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
      if (bonus > 0n && payment.appUserId) {
        const given = await giveEndUserCredit(tx, {
          orgId: payment.orgId,
          walletId: payment.walletId,
          amountMicros: bonus,
          description: 'Bônus do pacote (pago pela organização)',
          ...ref,
        });
        if (!given) {
          // The buyer still gets what they paid for; the bonus waits for nobody (audit only).
          await tx.payment.update({ where: { id: payment.id }, data: { creditMicros: base } });
          await tx.auditLog.create({
            data: {
              actorId: null,
              action: 'payment.bonus_skipped',
              target: payment.orgId,
              metadata: {
                paymentId: payment.id,
                appUserId: payment.appUserId,
                bonusMicros: bonus.toString(),
                reason: 'insufficient_org_balance',
              },
            },
          });
        }
      } else if (bonus > 0n) {
        await applyLedger(tx, {
          walletId: payment.walletId,
          type: 'BONUS',
          amountMicros: bonus,
          description: 'Bônus do pacote',
          ...ref,
        });
      }
      const credited = await tx.payment.findUniqueOrThrow({ where: { id: payment.id } });
      if (credited.projectId) {
        // Outbox: the events commit (or roll back) together with the credit.
        const data = await paymentEventData(tx, credited);
        await emitEvent(tx, credited.projectId, 'payment.received', data);
        if (credited.appUserId) await emitEvent(tx, credited.projectId, 'app_user.credited', data);
      }
      return credited;
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

/** Hold that freezes the credits of a charged-back payment (no expiry: released by reconcile). */
const chargebackHoldId = (paymentId: string) => `chargeback:${paymentId}`;
const FROZEN_UNTIL = new Date('2100-01-01T00:00:00Z');
/** Expired payments and webhook events are rechecked with the PSP for this long (R-11). */
export const RECONCILE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/** Releases a chargeback freeze, if any. Returns the amount released. */
async function unfreeze(tx: Tx, paymentId: string): Promise<bigint> {
  const rows = await tx.$queryRaw<{ walletId: string; amountMicros: bigint }[]>`
    DELETE FROM "WalletHold" WHERE id = ${chargebackHoldId(paymentId)}
    RETURNING "walletId", "amountMicros"`;
  const hold = rows[0];
  if (!hold) return 0n;
  if (hold.amountMicros > 0n) {
    await tx.$executeRaw`
      UPDATE "Wallet" SET "reservedMicros" = "reservedMicros" - ${hold.amountMicros}
       WHERE id = ${hold.walletId}`;
  }
  return hold.amountMicros;
}

/** Credits to take back for `refundedCents` returned: the same fraction of what was credited. */
function proportionalMicros(payment: Payment, refundedCents: number): bigint {
  if (payment.amountCents <= 0) return payment.creditMicros;
  const target = ceilDiv(payment.creditMicros * BigInt(refundedCents), BigInt(payment.amountCents));
  return target < payment.creditMicros ? target : payment.creditMicros;
}

/**
 * Takes back the credits of a refunded payment up to `targetMicros` in total (PIE R-06):
 * a partial refund debits the same fraction of the credits delivered (bonus included), and a
 * later refund only debits the difference (`Payment.refundedMicros`). Debits at most what is
 * still available: a refund never leaves anyone owing (D-128). Credits already spent are a
 * shortfall: the organization is suspended, or the end user blocked (R-07).
 * Without `targetMicros` the whole payment is refunded.
 */
export async function applyRefund(
  prisma: PrismaClient,
  paymentId: string,
  targetMicros?: bigint,
): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT 1 FROM "Payment" WHERE id = ${paymentId} FOR UPDATE`;
    const payment = await tx.payment.findUnique({ where: { id: paymentId } });
    if (!payment?.creditedAt) return false;
    let target = targetMicros ?? payment.creditMicros;
    if (target > payment.creditMicros) target = payment.creditMicros;
    const delta = target - payment.refundedMicros;
    if (delta <= 0n) return false;

    // Frozen credits (chargeback) are exactly what is being taken back now.
    await unfreeze(tx, payment.id);
    const [w] = await tx.$queryRaw<{ balanceMicros: bigint; reservedMicros: bigint }[]>`
      SELECT "balanceMicros", "reservedMicros" FROM "Wallet" WHERE id = ${payment.walletId} FOR UPDATE`;
    const available = (w?.balanceMicros ?? 0n) - (w?.reservedMicros ?? 0n);
    const debit = delta <= available ? delta : available > 0n ? available : 0n;
    const shortfall = delta - debit;
    const full = target === payment.creditMicros;
    if (debit > 0n) {
      await applyLedger(tx, {
        walletId: payment.walletId,
        type: 'REFUND',
        amountMicros: -debit,
        referenceType: 'payment',
        // The cumulative target makes each step unique: re-deliveries never debit twice.
        referenceId: payment.refundedMicros === 0n ? payment.id : `${payment.id}:${target}`,
        description: full ? 'Estorno da recarga via Pix' : 'Estorno parcial da recarga via Pix',
      });
    }
    await tx.payment.update({
      where: { id: payment.id },
      data: { refundedMicros: target, ...(full ? { status: 'REFUNDED' } : {}) },
    });
    if (shortfall > 0n) {
      // Paid, used the credits, then got the money back (refund/MED outside fusai). An
      // organization is suspended until the admin reviews it; an end user is blocked (R-07).
      if (payment.appUserId) {
        await tx.appUser.update({
          where: { id: payment.appUserId },
          data: { blockedAt: new Date() },
        });
      } else {
        await tx.organization.update({
          where: { id: payment.orgId },
          data: { status: 'SUSPENDED' },
        });
      }
      await tx.auditLog.create({
        data: {
          actorId: null,
          action: 'payment.refund_shortfall',
          target: payment.orgId,
          metadata: {
            paymentId: payment.id,
            creditMicros: payment.creditMicros.toString(),
            refundedMicros: target.toString(),
            debitedMicros: debit.toString(),
            shortfallMicros: shortfall.toString(),
            suspended: !payment.appUserId,
            appUserBlocked: payment.appUserId,
          },
        },
      });
    }
    if (payment.projectId) {
      const refunded = await tx.payment.findUniqueOrThrow({ where: { id: payment.id } });
      // The customer learns how much of the refund was already spent (R-07).
      await emitEvent(
        tx,
        payment.projectId,
        'payment.refunded',
        await paymentEventData(tx, refunded, {
          refund: {
            debitedMicros: debit.toString(),
            shortfallMicros: shortfall.toString(),
            refundedMicros: target.toString(),
            partial: !full,
          },
        }),
      );
    }
    return true;
  });
}

/**
 * Chargeback opened (PIE, owner's rule): the credits of that payment are frozen as a hold that
 * never expires, so they cannot be spent while the dispute lasts. What was already spent cannot
 * be frozen: the end user who did it is blocked. The organization keeps working.
 */
async function freezeForChargeback(prisma: PrismaClient, paymentId: string): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT 1 FROM "Payment" WHERE id = ${paymentId} FOR UPDATE`;
    const payment = await tx.payment.findUnique({ where: { id: paymentId } });
    if (!payment?.creditedAt) return false;
    const exists = await tx.walletHold.findUnique({ where: { id: chargebackHoldId(paymentId) } });
    if (exists) return false;
    const remaining = payment.creditMicros - payment.refundedMicros;
    if (remaining <= 0n) return false;
    const [w] = await tx.$queryRaw<{ balanceMicros: bigint; reservedMicros: bigint }[]>`
      SELECT "balanceMicros", "reservedMicros" FROM "Wallet" WHERE id = ${payment.walletId} FOR UPDATE`;
    const available = (w?.balanceMicros ?? 0n) - (w?.reservedMicros ?? 0n);
    const frozen = remaining <= available ? remaining : available > 0n ? available : 0n;
    if (frozen > 0n) {
      await tx.$executeRaw`
        UPDATE "Wallet" SET "reservedMicros" = "reservedMicros" + ${frozen}
         WHERE id = ${payment.walletId}`;
    }
    // A zero hold still marks the payment as frozen (repeated events do nothing).
    await tx.walletHold.create({
      data: {
        id: chargebackHoldId(paymentId),
        walletId: payment.walletId,
        amountMicros: frozen,
        expiresAt: FROZEN_UNTIL,
      },
    });
    const spent = remaining - frozen;
    if (spent > 0n && payment.appUserId) {
      await tx.appUser.update({
        where: { id: payment.appUserId },
        data: { blockedAt: new Date() },
      });
    }
    await tx.auditLog.create({
      data: {
        actorId: null,
        action: 'payment.chargeback_frozen',
        target: payment.orgId,
        metadata: {
          paymentId: payment.id,
          frozenMicros: frozen.toString(),
          spentMicros: spent.toString(),
          appUserBlocked: spent > 0n ? payment.appUserId : null,
        },
      },
    });
    return true;
  });
}

export type ReconcileResult = {
  remoteStatus: string;
  /** The PSP shows money returned to the payer (total or partial). */
  refundConfirmed: boolean;
};

/**
 * Brings a credited payment in line with the PSP (source of truth, never the webhook body):
 * refunds -> debit the proportional difference; chargeback -> freeze; paid again (dispute won)
 * -> unfreeze. Safe to run any number of times.
 */
export async function reconcilePayment(
  prisma: PrismaClient,
  provider: PaymentProvider,
  paymentId: string,
): Promise<ReconcileResult | null> {
  const payment = await prisma.payment.findUnique({ where: { id: paymentId } });
  if (!payment?.creditedAt || !payment.providerPaymentId) return null;
  const remote = await provider.getPayment(payment.providerPaymentId);
  const target =
    remote.status === 'REFUNDED'
      ? payment.creditMicros
      : remote.refundedCents > 0
        ? proportionalMicros(payment, remote.refundedCents)
        : 0n;
  if (target > payment.refundedMicros) await applyRefund(prisma, payment.id, target);
  if (remote.status === 'CHARGEBACK') {
    await freezeForChargeback(prisma, payment.id);
  } else if (remote.status === 'RECEIVED' || remote.status === 'CONFIRMED') {
    const released = await prisma.$transaction((tx) => unfreeze(tx, payment.id));
    if (released > 0n) {
      await prisma.auditLog.create({
        data: {
          actorId: null,
          action: 'payment.chargeback_released',
          target: payment.orgId,
          metadata: { paymentId: payment.id, releasedMicros: released.toString() },
        },
      });
    }
  }
  return { remoteStatus: remote.status, refundConfirmed: target > 0n };
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
  // R-11: a "paid" event the PSP does not confirm yet stays open and is retried for a while.
  let retry = false;
  try {
    const payment = await findPaymentForEvent(prisma, event);
    if (!payment) {
      error = 'payment_not_found';
    } else if (event.kind === 'paid' && payment.creditedAt) {
      // Paid again after a chargeback (dispute won): release the frozen credits.
      await reconcilePayment(prisma, provider, payment.id);
    } else if (event.kind === 'paid') {
      const result = await creditPayment(prisma, provider, payment.id);
      if (result.credited && result.payment)
        await hooks.onCredited?.(result.payment).catch(() => {});
      if (!result.credited && result.reason !== 'already_credited') {
        error = result.reason ?? 'not_credited';
        retry =
          error.startsWith('not_paid:') &&
          Date.now() - stored.createdAt.getTime() < RECONCILE_WINDOW_MS;
      }
    } else if (event.kind === 'refunded' || event.kind === 'chargeback') {
      // Same rule as the credit: the PSP decides how much moved, never the webhook body.
      const result = await reconcilePayment(prisma, provider, payment.id);
      // Not refunded at the PSP yet: throw, so the event stays pending and the sweep retries it.
      if (event.kind === 'refunded' && result && !result.refundConfirmed)
        throw new Error(`refund_not_confirmed:${result.remoteStatus}`);
    } else if (event.kind === 'review') {
      // Refund in progress / cash receipt undone: nothing to debit yet, but the admin sees it
      // in the audit log instead of the event being silently ignored.
      await prisma.auditLog.create({
        data: {
          actorId: null,
          action: 'payment.needs_review',
          target: payment.orgId,
          metadata: {
            paymentId: payment.id,
            event: event.type,
            valueCents: event.valueCents,
            credited: !!payment.creditedAt,
            appUserId: payment.appUserId,
          },
        },
      });
    } else if (event.kind === 'expired') {
      await markExpired(
        prisma,
        payment.id,
        event.type === 'PAYMENT_DELETED' ? 'CANCELED' : 'EXPIRED',
      );
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
    data: { processedAt: retry ? null : new Date(), error },
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
    // +1 s: timestamps are rounded up to the millisecond (see webhooks-out `dueBy`).
    where: { processedAt: null, createdAt: { lte: new Date(Date.now() - olderThanMs + 1000) } },
    orderBy: { createdAt: 'asc' },
    take: 100,
  });
  for (const e of pending) await processWebhookEvent(prisma, provider, e.id, hooks).catch(() => {});
  return pending.length;
}

/** PENDING -> EXPIRED/CANCELED once, with the payment.expired event for the project. */
async function markExpired(
  prisma: PrismaClient,
  paymentId: string,
  status: 'EXPIRED' | 'CANCELED',
): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    const res = await tx.payment.updateMany({
      where: { id: paymentId, status: 'PENDING', creditedAt: null },
      data: { status },
    });
    if (res.count === 0) return false;
    const payment = await tx.payment.findUniqueOrThrow({ where: { id: paymentId } });
    if (payment.projectId) {
      await emitEvent(
        tx,
        payment.projectId,
        'payment.expired',
        await paymentEventData(tx, payment),
      );
    }
    return true;
  });
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
    if (await markExpired(prisma, p.id, 'EXPIRED')) expired += 1;
  }
  return expired;
}

/**
 * Periodic reconciliation with the PSP (PIE R-11 and chargebacks):
 * - expired payments of the last 7 days that the PSP says were paid get credited (late Pix,
 *   or an OVERDUE event processed before the RECEIVED one);
 * - frozen chargebacks are rechecked until the dispute ends (released or refunded).
 */
export async function reconcilePayments(
  prisma: PrismaClient,
  provider: PaymentProvider,
  hooks: ProcessHooks = {},
) {
  let credited = 0;
  const expired = await prisma.payment.findMany({
    where: {
      status: 'EXPIRED',
      creditedAt: null,
      providerPaymentId: { not: null },
      createdAt: { gte: new Date(Date.now() - RECONCILE_WINDOW_MS) },
    },
    orderBy: { createdAt: 'desc' },
    take: 200,
  });
  for (const p of expired) {
    try {
      const remote = await provider.getPayment(p.providerPaymentId as string);
      if (remote.status !== 'RECEIVED' && remote.status !== 'CONFIRMED') continue;
      const result = await creditPayment(prisma, provider, p.id);
      if (result.credited && result.payment) {
        credited += 1;
        await hooks.onCredited?.(result.payment).catch(() => {});
      }
    } catch {
      // PSP unavailable: next run.
    }
  }
  const frozen = await prisma.walletHold.findMany({
    where: { id: { startsWith: 'chargeback:' } },
    select: { id: true },
    take: 200,
  });
  for (const h of frozen) {
    await reconcilePayment(prisma, provider, h.id.slice('chargeback:'.length)).catch(() => {});
  }
  return { credited, frozen: frozen.length };
}
