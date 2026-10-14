/**
 * Payment service provider abstraction (PRD §9.2). Asaas today; Mercado Pago / Efí later.
 * Amounts cross this boundary in integer cents.
 */

export type ProviderPaymentStatus =
  | 'PENDING'
  | 'RECEIVED'
  | 'CONFIRMED'
  | 'OVERDUE'
  | 'REFUNDED'
  | 'DELETED'
  | 'OTHER';

export type NormalizedPaymentEvent = {
  /** Provider event id when available, else `${type}:${paymentId}` (idempotency key). */
  eventKey: string;
  type: string;
  kind: 'paid' | 'refunded' | 'expired' | 'ignored';
  providerPaymentId: string | null;
  externalRef: string | null;
  valueCents: number | null;
};

export type ProviderPayment = {
  providerPaymentId: string;
  status: ProviderPaymentStatus;
  valueCents: number;
  externalRef: string | null;
};

export interface PaymentProvider {
  readonly kind: 'ASAAS';
  ensureCustomer(input: {
    name: string;
    document: string;
    email?: string;
    externalRef: string;
  }): Promise<string>;
  createPixCharge(input: {
    customerId: string;
    amountCents: number;
    description: string;
    externalRef: string;
    dueDate: Date;
  }): Promise<{ providerPaymentId: string }>;
  getPixQrCode(
    providerPaymentId: string,
  ): Promise<{ copyPaste: string; qrBase64: string; expiresAt: Date }>;
  /** Source of truth before crediting: never trust a webhook body alone. */
  getPayment(providerPaymentId: string): Promise<ProviderPayment>;
  /** Authenticates and normalizes a webhook; null when the token is invalid. */
  parseWebhook(
    headers: Record<string, string | string[] | undefined>,
    body: unknown,
  ): Promise<NormalizedPaymentEvent | null>;
  refund(providerPaymentId: string): Promise<void>;
  /** Cancels an unpaid charge so the QR code can no longer be paid. */
  cancel(providerPaymentId: string): Promise<void>;
}

export class PaymentProviderError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly code = 'payment_provider_error',
  ) {
    super(message);
  }
}
