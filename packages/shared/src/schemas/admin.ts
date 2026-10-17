import { z } from 'zod';
import { compareDecimals, isDecimalString } from '../decimal';

const decimal = (maxDecimals: number, message = 'Número inválido') =>
  z
    .string()
    .trim()
    .transform((v) => v.replace(',', '.'))
    .refine((v) => isDecimalString(v, maxDecimals), message);

const positiveDecimal = (maxDecimals: number) =>
  decimal(maxDecimals).refine((v) => compareDecimals(v, '0') > 0, 'Precisa ser maior que zero');

/** Integer amount in micros, sent as a digit string (BigInt-safe in JSON). */
export const microsString = z.string().trim().regex(/^\d+$/, 'Valor inválido');

// ---- Providers ----

export const providerStatuses = ['ACTIVE', 'DISABLED'] as const;

const providerFields = {
  name: z.string().trim().min(2).max(60),
  baseUrl: z
    .url('URL inválida')
    .trim()
    .transform((v) => v.replace(/\/+$/, '')),
  status: z.enum(providerStatuses),
  priority: z.coerce.number().int().min(0).max(10_000),
  timeoutMs: z.coerce.number().int().min(1_000).max(600_000),
};

export const providerCreateSchema = z.object({
  slug: z
    .string()
    .trim()
    .regex(/^[a-z0-9][a-z0-9-]{1,31}$/, 'Use letras minúsculas, números e hífen'),
  ...providerFields,
  status: providerFields.status.default('DISABLED'),
  priority: providerFields.priority.default(100),
  timeoutMs: providerFields.timeoutMs.default(120_000),
  apiKey: z.string().trim().min(8, 'Chave muito curta').max(512).optional(),
});
export type ProviderCreateInput = z.input<typeof providerCreateSchema>;

export const providerUpdateSchema = z
  .object({
    ...providerFields,
    apiKey: z.string().trim().min(8, 'Chave muito curta').max(512),
  })
  .partial();
export type ProviderUpdateInput = z.input<typeof providerUpdateSchema>;

// ---- Models ----

export const priceModes = ['AUTO', 'FIXED'] as const;

/**
 * No zod defaults here on purpose: in zod 4 `.partial()` still applies defaults, which would
 * reset omitted fields on PATCH. The API applies create defaults and validates FIXED prices
 * against the merged record.
 */
const modelFields = z.object({
  slug: z
    .string()
    .trim()
    .regex(/^[a-z0-9][a-z0-9._/-]{1,63}$/, 'Use minúsculas, números, ".", "-", "_" e "/"'),
  displayName: z.string().trim().min(2).max(80),
  description: z.string().trim().max(500).nullable(),
  providerId: z.string().min(1, 'Escolha o provedor'),
  upstreamModel: z.string().trim().min(1).max(120),
  contextWindow: z.coerce.number().int().min(1),
  maxOutputTokens: z.coerce.number().int().min(1),
  inputCostUsdPerM: decimal(8),
  cachedInputCostUsdPerM: decimal(8).nullable(),
  outputCostUsdPerM: decimal(8),
  priceMode: z.enum(priceModes),
  markupMultiplier: positiveDecimal(3).nullable(),
  inputPriceMicrosPerM: microsString.nullable(),
  outputPriceMicrosPerM: microsString.nullable(),
  supportsTools: z.boolean(),
  supportsVision: z.boolean(),
  supportsReasoning: z.boolean(),
  fallbackModelIds: z.array(z.string().min(1)).max(5),
  active: z.boolean(),
  public: z.boolean(),
  sortOrder: z.coerce.number().int(),
});

export const modelCreateSchema = modelFields.partial().required({
  slug: true,
  displayName: true,
  providerId: true,
  upstreamModel: true,
  contextWindow: true,
  inputCostUsdPerM: true,
  outputCostUsdPerM: true,
});
export type ModelCreateInput = z.input<typeof modelCreateSchema>;

export const modelUpdateSchema = modelFields.partial();
export type ModelUpdateInput = z.input<typeof modelUpdateSchema>;

/** FIXED price mode needs both fixed prices (checked on the merged record). */
export function fixedPricesMissing(m: {
  priceMode: string;
  inputPriceMicrosPerM: unknown;
  outputPriceMicrosPerM: unknown;
}): boolean {
  return (
    m.priceMode === 'FIXED' && (m.inputPriceMicrosPerM == null || m.outputPriceMicrosPerM == null)
  );
}

// ---- Global settings ----

export const settingsSchema = z.object({
  usd_brl_rate: positiveDecimal(6),
  default_markup: positiveDecimal(3),
  topup_fee_pct: decimal(2).refine((v) => compareDecimals(v, '100') <= 0, 'Máximo de 100%'),
  min_topup_cents: z.coerce.number().int().min(100, 'Mínimo de R$ 1,00'),
  low_balance_threshold_micros: microsString,
  welcome_bonus_micros: microsString,
  /** TEST keys only reach models whose output price per 1M tokens is at most this. */
  test_key_max_output_micros: microsString.default('50000000'),
});
export type SettingsInput = z.input<typeof settingsSchema>;
export type Settings = z.output<typeof settingsSchema>;

export const DEFAULT_SETTINGS: Settings = {
  usd_brl_rate: '5.50',
  default_markup: '4.0',
  topup_fee_pct: '0',
  min_topup_cents: 1000,
  low_balance_threshold_micros: '5000000',
  welcome_bonus_micros: '0',
  test_key_max_output_micros: '50000000',
};

// ---- Wallet adjustments ----

/** Largest single manual adjustment (R$ 1.000.000) — guards against typos. */
export const MAX_ADJUSTMENT_MICROS = 1_000_000_000_000n;
const INTEGER_RE = /^-?\d+$/;

export const walletAdjustSchema = z.object({
  /** Signed micros as a string: positive credits, negative debits. */
  amountMicros: z
    .string()
    .trim()
    .regex(/^-?\d+$/, 'Valor inválido')
    // zod 4 runs refinements even after the regex fails: only parse well-formed integers.
    .refine((v) => !INTEGER_RE.test(v) || BigInt(v) !== 0n, 'O valor não pode ser zero')
    .refine((v) => {
      if (!INTEGER_RE.test(v)) return true;
      const n = BigInt(v);
      return (n < 0n ? -n : n) <= MAX_ADJUSTMENT_MICROS;
    }, 'Valor acima do limite de R$ 1.000.000'),
  reason: z.string().trim().min(5, 'Descreva o motivo (mínimo 5 caracteres)').max(300),
});
export type WalletAdjustInput = z.input<typeof walletAdjustSchema>;

export const ledgerQuerySchema = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

export const orgSearchSchema = z.object({
  q: z.string().trim().max(100).optional(),
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

// ---- Customers (organizations) ----

export const orgStatuses = ['ACTIVE', 'SUSPENDED'] as const;
export const billingTypes = ['PREPAID', 'POSTPAID', 'INTERNAL'] as const;
/** Largest post-paid credit limit (R$ 1.000.000). */
export const MAX_CREDIT_LIMIT_MICROS = 1_000_000_000_000n;

export const orgAdminUpdateSchema = z
  .object({
    status: z.enum(orgStatuses),
    billingType: z.enum(billingTypes),
    creditLimitMicros: microsString.refine(
      (v) => !/^\d+$/.test(v) || BigInt(v) <= MAX_CREDIT_LIMIT_MICROS,
      'Limite acima de R$ 1.000.000',
    ),
    /** Special markup for this customer; null = global default. */
    markupOverride: positiveDecimal(3)
      .refine((v) => compareDecimals(v, '100') <= 0, 'Máximo de 100×')
      .nullable(),
    /** Required when suspending (shown in the audit log). */
    reason: z.string().trim().min(5, 'Descreva o motivo (mínimo 5 caracteres)').max(300),
  })
  .partial()
  .refine((v) => v.status !== 'SUSPENDED' || !!v.reason, {
    message: 'Informe o motivo da suspensão',
    path: ['reason'],
  });
export type OrgAdminUpdateInput = z.input<typeof orgAdminUpdateSchema>;

// ---- Users ----

export const userBanSchema = z.object({
  reason: z.string().trim().min(5, 'Descreva o motivo (mínimo 5 caracteres)').max(300),
});

export const adminListQuerySchema = z.object({
  q: z.string().trim().max(120).optional(),
  cursor: z.string().min(1).max(64).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});
