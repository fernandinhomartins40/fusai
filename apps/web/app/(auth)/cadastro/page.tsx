import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Suspense } from 'react';
import { AuthShell } from '@/components/auth/auth-shell';
import { SignUpForm } from '@/components/auth/sign-up-form';
import { getMe } from '@/lib/session';

export const metadata: Metadata = { title: 'Criar conta' };

export default async function SignUpPage() {
  if (await getMe()) redirect('/app');
  return (
    <AuthShell
      title="Criar conta"
      description="Uma API para os melhores modelos de IA, com créditos via Pix."
      footer={
        <>
          Já tem conta?{' '}
          <Link
            href="/entrar"
            className="font-medium text-foreground underline-offset-4 hover:underline"
          >
            Entrar
          </Link>
        </>
      }
    >
      <Suspense>
        <SignUpForm />
      </Suspense>
    </AuthShell>
  );
}
