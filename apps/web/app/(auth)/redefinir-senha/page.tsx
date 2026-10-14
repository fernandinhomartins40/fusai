import { Button } from '@fuseai/ui/components/button';
import type { Metadata } from 'next';
import Link from 'next/link';
import { AuthShell } from '@/components/auth/auth-shell';
import { ResetPasswordForm } from '@/components/auth/reset-password-form';
import { FormAlert } from '@/components/form-field';

export const metadata: Metadata = { title: 'Nova senha' };

type Props = { searchParams: Promise<{ token?: string; error?: string }> };

export default async function ResetPasswordPage({ searchParams }: Props) {
  const { token, error } = await searchParams;

  if (!token || error) {
    return (
      <AuthShell title="Link inválido">
        <div className="grid gap-4">
          <FormAlert>Este link é inválido ou expirou. Peça um novo link de recuperação.</FormAlert>
          <Button asChild variant="brand">
            <Link href="/recuperar-senha">Pedir novo link</Link>
          </Button>
        </div>
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
