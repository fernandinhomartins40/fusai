import { Button } from '@fusai/ui/components/button';
import type { Metadata } from 'next';
import Link from 'next/link';
import { AuthShell } from '@/components/auth/auth-shell';
import { ResetPasswordForm } from '@/components/auth/reset-password-form';
import { StatusPanel } from '@/components/auth/status-panel';

export const metadata: Metadata = { title: 'Nova senha' };

type Props = { searchParams: Promise<{ token?: string; error?: string }> };

export default async function ResetPasswordPage({ searchParams }: Props) {
  const { token, error } = await searchParams;

  if (!token || error) {
    const expired = !!error && /expired/i.test(error);
    return (
      <AuthShell title={expired ? 'Link expirado' : 'Link inválido'}>
        <StatusPanel
          tone={expired ? 'expired' : 'error'}
          actions={
            <>
              <Button asChild variant="brand">
                <Link href="/recuperar-senha">Pedir novo link</Link>
              </Button>
              <Button asChild variant="ghost">
                <Link href="/entrar">Voltar para o login</Link>
              </Button>
            </>
          }
        >
          <p>
            {expired
              ? 'O link para criar uma nova senha vale por 1 hora e este já expirou.'
              : 'Este link não é válido ou já foi usado. Peça um novo link de recuperação.'}
          </p>
        </StatusPanel>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Criar nova senha"
      description="Escolha uma senha forte que você não usa em outros sites."
    >
      <ResetPasswordForm token={token} />
    </AuthShell>
  );
}
