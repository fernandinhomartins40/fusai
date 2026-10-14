import { z } from 'zod';

export const apiKeyScopes = ['chat', 'billing:read', 'checkout', 'app_users', 'mcp'] as const;
export type ApiKeyScopeValue = (typeof apiKeyScopes)[number];

const limits = {
  /** Monthly spend limit in micros (string, BigInt-safe). null = unlimited. */
  spendLimitMicros: z.string().trim().regex(/^\d+$/, 'Valor inválido').nullable(),
  rpmLimit: z.coerce.number().int().min(1).max(10_000).nullable(),
};

export const apiKeyCreateSchema = z.object({
  name: z.string().trim().min(1, 'Dê um nome à chave').max(60),
  env: z.enum(['LIVE', 'TEST']).default('LIVE'),
  scopes: z
    .array(z.enum(apiKeyScopes))
    .min(1)
    .default([...apiKeyScopes]),
  spendLimitMicros: limits.spendLimitMicros.optional(),
  rpmLimit: limits.rpmLimit.optional(),
  expiresAt: z.iso.datetime().nullable().optional(),
});
export type ApiKeyCreateInput = z.input<typeof apiKeyCreateSchema>;

/** No defaults on purpose (zod 4 `.partial()` would apply them on PATCH). */
export const apiKeyUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(60),
    scopes: z.array(z.enum(apiKeyScopes)).min(1),
    ...limits,
  })
  .partial();
export type ApiKeyUpdateInput = z.input<typeof apiKeyUpdateSchema>;
