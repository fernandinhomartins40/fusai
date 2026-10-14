import { createAuthClient } from 'better-auth/react';
import { API_URL } from './config';

export const authClient = createAuthClient({
  baseURL: API_URL,
  fetchOptions: { credentials: 'include' },
});

const messages: Record<string, string> = {
  INVALID_EMAIL_OR_PASSWORD: 'Email ou senha incorretos.',
  EMAIL_NOT_VERIFIED:
    'Confirme seu email antes de entrar. Reenviamos o link para sua caixa de entrada.',
  USER_ALREADY_EXISTS: 'Já existe uma conta com este email.',
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: 'Já existe uma conta com este email.',
  PASSWORD_TOO_SHORT: 'A senha é muito curta.',
  PASSWORD_TOO_LONG: 'A senha é muito longa.',
  INVALID_TOKEN: 'Link inválido ou expirado. Peça um novo.',
  TOO_MANY_REQUESTS: 'Muitas tentativas. Aguarde um minuto e tente novamente.',
};

/** Maps Better Auth error codes to pt-BR messages. */
export function authErrorMessage(
  error: { code?: string; status?: number } | null | undefined,
): string {
  const code = error?.status === 429 ? 'TOO_MANY_REQUESTS' : error?.code;
  return (code && messages[code]) || 'Algo deu errado. Tente novamente.';
}
