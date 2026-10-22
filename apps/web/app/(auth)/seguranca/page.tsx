import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { AuthShell } from '@/components/auth/auth-shell';
import { AdminMfaGate } from '@/components/security/admin-mfa-gate';
import { getMe } from '@/lib/session';

export const metadata: Metadata = { title: 'Verificação em duas etapas' };

/** Only same-site panel paths are accepted as the destination after the code. */
function safeNext(value: string | string[] | undefined, fallback: string): string {
  const next = Array.isArray(value) ? value[0] : value;
  return next && /^\/(app|admin)(\/|$|\?)/.test(next) ? next : fallback;
}

/**
 * PIE S-05: the authenticator code before the panel opens. Mandatory for super admins (enroll
 * here if needed); for anyone with 2FA on, it closes a sign-in that skipped the code (Google).
 */
export default async function SecurityCheckPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  const me = await getMe();
  const isAdmin = me?.user.role === 'SUPER_ADMIN';
  const next = safeNext((await searchParams).next, isAdmin ? '/admin' : '/app');
  if (!me) redirect(`/entrar?next=${encodeURIComponent(next)}`);
  if (me.user.mfaVerified) redirect(next);
  const enrolled = me.user.twoFactorEnabled;
  if (!isAdmin && !enrolled) redirect(next);
  const toAdmin = next.startsWith('/admin');
  return (
    <AuthShell
      title="Verificação em duas etapas"
      description={
        enrolled
          ? `Confirme o código do app autenticador para abrir o ${toAdmin ? 'painel admin' : 'painel'}.`
          : 'O painel admin exige um app autenticador além da senha.'
      }
    >
      <AdminMfaGate
        enrolled={enrolled}
        next={next}
        submitLabel={toAdmin ? 'Abrir o painel admin' : 'Abrir o painel'}
      />
    </AuthShell>
  );
}
