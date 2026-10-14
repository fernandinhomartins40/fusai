import { MailCheck } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AuthShell } from '@/components/auth/auth-shell';
import { ResendVerification } from '@/components/auth/resend-verification';
import { FormAlert } from '@/components/form-field';
import { getMe } from '@/lib/session';

export const metadata: Metadata = { title: 'Confirme seu email' };

type Props = { searchParams: Promise<{ email?: string; error?: string; confirmado?: string }> };

export default async function VerifyEmailPage({ searchParams }: Props) {
  const { email, error, confirmado } = await searchParams;

  // Better Auth redirects here after a successful confirmation, already signed in.
  if (confirmado && !error && (await getMe())) redirect('/app');

  return (
    <AuthShell
      title={error ? 'Não foi possível confirmar' : 'Confirme seu email'}
      description={
        error ? undefined : (
          <span className="flex items-start gap-2">
            <MailCheck className="mt-0.5 size-4 shrink-0 text-fuse-pink" aria-hidden />
            <span>
              Enviamos um link de confirmação{email ? ` para ${email}` : ''}. Abra o email e clique
              no botão para ativar sua conta.
            </span>
          </span>
        )
      }
      footer={
        <Link
          href="/entrar"
          className="font-medium text-foreground underline-offset-4 hover:underline"
        >
          Voltar para o login
        </Link>
      }
    >
      <div className="grid gap-4">
        {error ? (
          <FormAlert>O link é inválido ou expirou. Peça um novo abaixo.</FormAlert>
        ) : (
          <p className="text-muted-foreground text-sm">Não recebeu? Confira o spam ou reenvie:</p>
        )}
        <ResendVerification defaultEmail={email} />
      </div>
    </AuthShell>
  );
}
