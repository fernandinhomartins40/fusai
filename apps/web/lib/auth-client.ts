import { adminClient, twoFactorClient } from 'better-auth/client/plugins';
import { createAuthClient } from 'better-auth/react';
import { API_URL } from './config';

export const authClient = createAuthClient({
  baseURL: API_URL,
  fetchOptions: { credentials: 'include' },
  // Super admin: "entrar como cliente" (impersonation) and back. Two-factor (TOTP): the sign-in
  // form handles `twoFactorRedirect` itself, so no automatic redirect here.
  plugins: [adminClient(), twoFactorClient()],
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
  ACCOUNT_TEMPORARILY_LOCKED:
    'Muitas tentativas de senha nesta conta. Aguarde 15 minutos ou redefina sua senha.',
  INVALID_CODE: 'Código incorreto. Confira o app autenticador e tente de novo.',
  INVALID_BACKUP_CODE: 'Código de recuperação inválido ou já usado.',
  INVALID_TWO_FACTOR_COOKIE: 'A verificação expirou. Entre com email e senha de novo.',
  TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE: 'Muitas tentativas. Entre com email e senha de novo.',
  TOTP_ALREADY_ENABLED: 'A verificação em duas etapas já está ativa.',
  INVALID_PASSWORD: 'Senha incorreta.',
  MFA_REQUIRED: 'Confirme a verificação em duas etapas para usar o painel admin.',
  BANNED_USER: 'Sua conta está bloqueada. Fale com o suporte da fusai.',
};

/** Maps Better Auth error codes to pt-BR messages. */
export function authErrorMessage(
  error: { code?: string; status?: number } | null | undefined,
): string {
  const code =
    error?.status === 429 && error.code !== 'ACCOUNT_TEMPORARILY_LOCKED'
      ? 'TOO_MANY_REQUESTS'
      : error?.code;
  return (code && messages[code]) || 'Algo deu errado. Tente novamente.';
}
