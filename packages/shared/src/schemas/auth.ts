import { z } from 'zod';

export const PASSWORD_MIN_LENGTH = 8;

const email = z.email('Email inválido').trim().toLowerCase();
const password = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `A senha precisa ter pelo menos ${PASSWORD_MIN_LENGTH} caracteres`)
  .max(128);

export const signUpSchema = z.object({
  name: z.string().trim().min(2, 'Informe seu nome').max(80),
  email,
  password,
});

export const signInSchema = z.object({
  email,
  password: z.string().min(1, 'Informe sua senha'),
});

export const forgotPasswordSchema = z.object({ email });

export const resetPasswordSchema = z
  .object({ password, confirm: z.string() })
  .refine((v) => v.password === v.confirm, {
    message: 'As senhas não conferem',
    path: ['confirm'],
  });
