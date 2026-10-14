import { z } from 'zod';
import { isValidDocument, onlyDigits } from '../document';

export const billingModes = ['ORG_WALLET', 'END_USER_WALLET', 'HYBRID'] as const;
export type BillingModeValue = (typeof billingModes)[number];

export const createOrganizationSchema = z.object({
  name: z.string().trim().min(2, 'Informe o nome da organização').max(80),
  document: z.string().trim().refine(isValidDocument, 'CPF ou CNPJ inválido').transform(onlyDigits),
  phone: z
    .string()
    .trim()
    .transform(onlyDigits)
    .refine((v) => v.length >= 10 && v.length <= 13, 'Telefone inválido'),
});
export type CreateOrganizationInput = z.input<typeof createOrganizationSchema>;

export const createProjectSchema = z.object({
  name: z.string().trim().min(2, 'Informe o nome do projeto').max(60),
  billingMode: z.enum(billingModes).default('ORG_WALLET'),
});
export type CreateProjectInput = z.input<typeof createProjectSchema>;
