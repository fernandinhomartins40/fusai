import { timingSafeEqual } from 'node:crypto';
import {
  type NormalizedPaymentEvent,
  type PaymentProvider,
  PaymentProviderError,
  type ProviderPayment,
  type ProviderPaymentStatus,
} from './types';

/**
 * Asaas (Pix) — checked against docs.asaas.com (Oct/2026):
 * - auth: `access_token` header (not Authorization), User-Agent required for new accounts;
 * - sandbox https://api-sandbox.asaas.com/v3, production https://api.asaas.com/v3;
 * - webhook auth: the token configured in Asaas arrives in `asaas-access-token`;
 * - webhook body: `{ id: "evt_…", event: "PAYMENT_RECEIVED", payment: { id, status, value, externalReference } }`,
 *   delivered at least once (dedupe by event id).
 */
export const ASAAS_URLS = {
  sandbox: 'https://api-sandbox.asaas.com/v3',
  production: 'https://api.asaas.com/v3',
} as const;

const PAID_EVENTS = new Set(['PAYMENT_RECEIVED', 'PAYMENT_CONFIRMED']);
const REFUND_EVENTS = new Set(['PAYMENT_REFUNDED']);
const EXPIRED_EVENTS = new Set(['PAYMENT_OVERDUE', 'PAYMENT_DELETED']);

const toCents = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? Math.round(value * 100) : null;

/** Cents -> reais with exactly two decimals, as Asaas expects (no float arithmetic on money). */
const toReais = (cents: number) =>
  Number(`${Math.trunc(cents / 100)}.${String(cents % 100).padStart(2, '0')}`);

function ymd(date: Date) {
  // Due date in São Paulo time (UTC-3, no DST).
  return new Date(date.getTime() - 3 * 3_600_000).toISOString().slice(0, 10);
}

function mapStatus(status: unknown): ProviderPaymentStatus {
  switch (status) {
    case 'PENDING':
    case 'RECEIVED':
    case 'CONFIRMED':
    case 'OVERDUE':
    case 'REFUNDED':
      return status;
    case 'RECEIVED_IN_CASH':
      return 'RECEIVED';
    default:
      return 'OTHER';
  }
}

export type AsaasConfig = {
  apiKey: string;
  baseUrl: string;
  webhookToken: string;
  timeoutMs?: number;
};

export class AsaasProvider implements PaymentProvider {
  readonly kind = 'ASAAS' as const;

  constructor(private readonly config: AsaasConfig) {}

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${this.config.baseUrl}${path}`, {
        method,
        headers: {
          access_token: this.config.apiKey,
          'content-type': 'application/json',
          accept: 'application/json',
          'user-agent': 'FuseAI/1.0 (+https://www.fuseai.com.br)',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(this.config.timeoutMs ?? 20_000),
      });
    } catch {
      throw new PaymentProviderError(
        'Não foi possível falar com o Asaas',
        null,
        'asaas_unreachable',
      );
    }
    const text = await res.text();
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {}
    if (!res.ok) {
      const errors = (data as { errors?: { description?: string }[] } | null)?.errors;
      const message =
        errors
          ?.map((e) => e.description)
          .filter(Boolean)
          .join('; ') || `Asaas respondeu ${res.status}`;
      throw new PaymentProviderError(message, res.status);
    }
    return data as T;
  }

  async ensureCustomer(input: {
    name: string;
    document: string;
    email?: string;
    externalRef: string;
  }) {
    // The API allows duplicates: callers cache the id (Organization.asaasCustomerId).
    const customer = await this.request<{ id: string }>('POST', '/customers', {
      name: input.name,
      cpfCnpj: input.document,
      ...(input.email ? { email: input.email } : {}),
      externalReference: input.externalRef,
      notificationDisabled: true, // FuseAI sends its own e-mails
    });
    return customer.id;
  }

  async createPixCharge(input: {
    customerId: string;
    amountCents: number;
    description: string;
    externalRef: string;
    dueDate: Date;
  }) {
    const payment = await this.request<{ id: string }>('POST', '/payments', {
      customer: input.customerId,
      billingType: 'PIX',
      value: toReais(input.amountCents),
      dueDate: ymd(input.dueDate),
      description: input.description.slice(0, 500),
      externalReference: input.externalRef,
    });
    return { providerPaymentId: payment.id };
  }

  async getPixQrCode(providerPaymentId: string) {
    const qr = await this.request<{
      encodedImage: string;
      payload: string;
      expirationDate: string;
    }>('GET', `/payments/${encodeURIComponent(providerPaymentId)}/pixQrCode`);
    return {
      copyPaste: qr.payload,
      qrBase64: qr.encodedImage,
      expiresAt: new Date(qr.expirationDate),
    };
  }

  async getPayment(providerPaymentId: string): Promise<ProviderPayment> {
    const p = await this.request<{
      id: string;
      status: string;
      value: number;
      externalReference?: string | null;
      deleted?: boolean;
    }>('GET', `/payments/${encodeURIComponent(providerPaymentId)}`);
    return {
      providerPaymentId: p.id,
      status: p.deleted ? 'DELETED' : mapStatus(p.status),
      valueCents: toCents(p.value) ?? 0,
      externalRef: p.externalReference ?? null,
    };
  }

  async parseWebhook(
    headers: Record<string, string | string[] | undefined>,
    body: unknown,
  ): Promise<NormalizedPaymentEvent | null> {
    const raw = headers['asaas-access-token'];
    const token = Array.isArray(raw) ? raw[0] : raw;
    const expected = Buffer.from(this.config.webhookToken);
    const given = Buffer.from(token ?? '');
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;

    const b = (body ?? {}) as {
      id?: unknown;
      event?: unknown;
      payment?: { id?: unknown; externalReference?: unknown; value?: unknown };
    };
    const type = typeof b.event === 'string' ? b.event : 'UNKNOWN';
    const paymentId = typeof b.payment?.id === 'string' ? b.payment.id : null;
    const kind = PAID_EVENTS.has(type)
      ? 'paid'
      : REFUND_EVENTS.has(type)
        ? 'refunded'
        : EXPIRED_EVENTS.has(type)
          ? 'expired'
          : 'ignored';
    return {
      eventKey: typeof b.id === 'string' && b.id ? b.id : `${type}:${paymentId ?? 'none'}`,
      type,
      kind,
      providerPaymentId: paymentId,
      externalRef:
        typeof b.payment?.externalReference === 'string' ? b.payment.externalReference : null,
      valueCents: toCents(b.payment?.value),
    };
  }

  async refund(providerPaymentId: string) {
    await this.request('POST', `/payments/${encodeURIComponent(providerPaymentId)}/refund`, {});
  }

  async cancel(providerPaymentId: string) {
    await this.request('DELETE', `/payments/${encodeURIComponent(providerPaymentId)}`);
  }
}
