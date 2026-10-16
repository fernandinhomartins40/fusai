import { z } from 'zod';

import { PASSWORD_MAX_LENGTH, passwordProblem } from '../password';

const email = z.email('Email inválido').trim().toLowerCase();
/** Strong password (same rule the API enforces): see ../password.ts. */
const password = z
  .string()
  .max(PASSWORD_MAX_LENGTH)
  .superRefine((value, ctx) => {
    const problem = passwordProblem(value);
    if (problem) ctx.addIssue({ code: 'custom', message: problem });
  });

const sameAs = { message: 'As senhas não conferem', path: ['confirm'] };

export const signUpSchema = z
  .object({
    name: z.string().trim().min(2, 'Informe seu nome').max(80),
    email,
    password,
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, sameAs);

export const signInSchema = z.object({
  email,
  password: z.string().min(1, 'Informe sua senha'),
  rememberMe: z.boolean().optional(),
  rememberEmail: z.boolean().optional(),
});

export const forgotPasswordSchema = z.object({ email });

export const resetPasswordSchema = z
  .object({ password, confirm: z.string() })
  .refine((v) => v.password === v.confirm, sameAs);
