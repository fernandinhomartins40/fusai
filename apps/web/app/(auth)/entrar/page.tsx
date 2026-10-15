import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Suspense } from 'react';
import { AuthShell } from '@/components/auth/auth-shell';
import { SignInForm } from '@/components/auth/sign-in-form';
import { getMe } from '@/lib/session';

export const metadata: Metadata = { title: 'Entrar' };

export default async function SignInPage() {
  if (await getMe()) redirect('/app');
  return (
    <AuthShell
      title="Entrar"
      description="Acesse o painel da fusai."
      footer={
        <>
          Ainda não tem conta?{' '}
          <Link
            href="/cadastro"
            className="font-medium text-foreground underline-offset-4 hover:underline"
          >
            Criar conta grátis
          </Link>
        </>
      }
    >
      <Suspense>
        <SignInForm />
      </Suspense>
    </AuthShell>
  );
}
