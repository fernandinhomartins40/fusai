import { Button } from '@fusai/ui/components/button';
import type { Metadata } from 'next';
import Link from 'next/link';
import { AuthShell } from '@/components/auth/auth-shell';
import { AutoRedirect } from '@/components/auth/auto-redirect';
import { ResendVerification } from '@/components/auth/resend-verification';
import { StatusPanel } from '@/components/auth/status-panel';
import { safeNext } from '@/lib/safe-redirect';
import { getMe } from '@/lib/session';

export const metadata: Metadata = { title: 'Confirmação de email' };

type Props = {
  searchParams: Promise<{ email?: string; error?: string; confirmado?: string; next?: string }>;
};

const backToLogin = (
  <Link href="/entrar" className="font-medium text-foreground underline-offset-4 hover:underline">
    Voltar para o login
  </Link>
);

/**
 * Every step of email confirmation has its own screen:
 * - pending (just signed up): check your inbox, resend;
 * - confirmed (Better Auth redirects here with ?confirmado=1): success, then the dashboard;
 * - link expired / invalid (Better Auth adds ?error=token_expired | invalid_token): resend.
 */
export default async function VerifyEmailPage({ searchParams }: Props) {
  const { email, error, confirmado, next } = await searchParams;

  if (confirmado && !error) {
    const me = await getMe();
    const dest = safeNext(next);
    return (
      <AuthShell title="Email confirmado!">
        <StatusPanel
          tone="success"
          actions={
            me ? (
              <>
                <Button asChild variant="brand">
                  <Link href={dest}>Ir para o painel</Link>
                </Button>
                <AutoRedirect href={dest} />
              </>
            ) : (
              <Button asChild variant="brand">
                <Link href={`/entrar?next=${encodeURIComponent(dest)}`}>Entrar na minha conta</Link>
              </Button>
            )
          }
        >
          <p className="font-medium text-base text-foreground">Sua conta fusai está ativa.</p>
          <p>
            {me
              ? 'Você já está conectado. Vamos levar você ao painel.'
              : 'Agora é só entrar com seu email e senha.'}
          </p>
        </StatusPanel>
      </AuthShell>
    );
  }

  if (error) {
    const expired = /expired/i.test(error);
    return (
      <AuthShell title={expired ? 'Link expirado' : 'Link inválido'} footer={backToLogin}>
        <div className="grid gap-6">
          <StatusPanel tone={expired ? 'expired' : 'error'}>
            <p>
              {expired
                ? 'Por segurança, o link de confirmação vale por pouco tempo. Peça um novo abaixo.'
                : 'Este link de confirmação não é válido ou já foi usado. Se sua conta já está ativa, é só entrar.'}
            </p>
          </StatusPanel>
          <ResendVerification defaultEmail={email} />
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Confirme seu email" footer={backToLogin}>
      <div className="grid gap-6">
        <StatusPanel tone="info">
          <p className="font-medium text-base text-foreground">Enviamos um link de confirmação</p>
          <p>
            {email ? (
              <>
                para <strong className="text-foreground">{email}</strong>.
              </>
            ) : (
              'para o seu email.'
            )}{' '}
            Abra o email e clique no botão para ativar sua conta.
          </p>
        </StatusPanel>
        <div className="grid gap-2">
          <p className="text-muted-foreground text-sm">Não recebeu? Confira o spam ou reenvie:</p>
          <ResendVerification defaultEmail={email} />
        </div>
      </div>
    </AuthShell>
  );
}
