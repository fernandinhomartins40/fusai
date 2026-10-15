import { z } from 'zod';
import { isValidDocument, onlyDigits } from '../document';
import { billingModes } from './onboarding';

const INTEGER_RE = /^\d+$/;
const micros = (max: bigint, message: string) =>
  z
    .string()
    .trim()
    .regex(INTEGER_RE, 'Valor inválido')
    .refine((v) => !INTEGER_RE.test(v) || BigInt(v) <= max, message);

/** An origin is scheme://host[:port] with nothing after it (what browsers send in `Origin`). */
export const originSchema = z
  .string()
  .trim()
  .refine((v) => {
    try {
      const url = new URL(v);
      return (url.protocol === 'https:' || url.protocol === 'http:') && url.origin === v;
    } catch {
      return false;
    }
  }, 'Use apenas a origem, ex.: https://app.exemplo.com');

/** Fields are optional with no defaults: PATCH only touches what was sent. */
export const projectUpdateSchema = z
  .object({
    name: z.string().trim().min(2).max(60),
    billingMode: z.enum(billingModes),
    allowedOrigins: z.array(originSchema).max(20),
    allowedModelIds: z.array(z.string().min(1)).max(200),
    defaultModelId: z.string().min(1).nullable(),
    webhookUrl: z.url('URL inválida').trim().max(500).nullable(),
    freeCreditMicros: micros(1_000_000_000n, 'Máximo de R$ 1.000 de crédito grátis'),
  })
  .partial();
export type ProjectUpdateInput = z.input<typeof projectUpdateSchema>;

export const orgUpdateSchema = z
  .object({
    name: z.string().trim().min(2).max(80),
    document: z
      .string()
      .trim()
      .refine(isValidDocument, 'CPF ou CNPJ inválido')
      .transform(onlyDigits),
    phone: z
      .string()
      .trim()
      .transform(onlyDigits)
      .refine((v) => v.length >= 10 && v.length <= 13, 'Telefone inválido'),
    lowBalanceAlertMicros: micros(1_000_000_000_000n, 'Valor muito alto').nullable(),
    suggestedTopupCents: z.coerce.number().int().min(100).max(10_000_000).nullable(),
  })
  .partial();
export type OrgUpdateInput = z.input<typeof orgUpdateSchema>;

export const orgRoles = ['OWNER', 'ADMIN', 'DEVELOPER', 'BILLING'] as const;
export type OrgRoleValue = (typeof orgRoles)[number];

export const inviteSchema = z.object({
  email: z.email('Email inválido').trim().toLowerCase(),
  role: z.enum(orgRoles).default('DEVELOPER'),
});
export type InviteInput = z.input<typeof inviteSchema>;

export const memberRoleSchema = z.object({ role: z.enum(orgRoles) });

const isoDate = z.iso.datetime({ offset: true });

export const usageFilterSchema = z.object({
  from: isoDate.optional(),
  to: isoDate.optional(),
  projectId: z.string().min(1).optional(),
  modelId: z.string().min(1).optional(),
});
export type UsageFilter = z.infer<typeof usageFilterSchema>;

export const logsQuerySchema = usageFilterSchema.extend({
  status: z
    .enum(['SUCCESS', 'UPSTREAM_ERROR', 'CLIENT_ERROR', 'INSUFFICIENT_FUNDS', 'RATE_LIMITED'])
    .optional(),
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

/** Credit package a project sells to its end users (PRD §9.3). Pix at Asaas starts at R$ 5. */
export const projectPackageSchema = z.object({
  name: z.string().trim().min(2, 'Nome muito curto').max(60),
  priceCents: z.coerce
    .number()
    .int()
    .min(500, 'O preço mínimo é R$ 5,00')
    .max(1_000_000, 'O preço máximo é R$ 10.000,00'),
  creditMicros: micros(10_000_000_000n, 'Máximo de R$ 10.000 em créditos').refine(
    (v) => !INTEGER_RE.test(v) || BigInt(v) > 0n,
    'Informe os créditos',
  ),
  bonusMicros: micros(10_000_000_000n, 'Máximo de R$ 10.000 de bônus'),
  highlight: z.boolean(),
  active: z.boolean(),
  sortOrder: z.coerce.number().int().min(0).max(1000),
});
export const projectPackageUpdateSchema = projectPackageSchema.partial();
export type ProjectPackageInput = z.input<typeof projectPackageSchema>;

/** Manual credit adjustment for an end user: positive = bonus, negative = removal. */
export const appUserAdjustSchema = z.object({
  amountMicros: z
    .string()
    .trim()
    .regex(/^-?\d+$/, 'Valor inválido')
    .refine((v) => {
      if (!/^-?\d+$/.test(v)) return true;
      const n = BigInt(v);
      return n !== 0n && n <= 1_000_000_000n && n >= -1_000_000_000n;
    }, 'Use um valor diferente de zero, até R$ 1.000'),
  description: z.string().trim().min(3, 'Descreva o motivo').max(200),
});
export type AppUserAdjustInput = z.input<typeof appUserAdjustSchema>;
