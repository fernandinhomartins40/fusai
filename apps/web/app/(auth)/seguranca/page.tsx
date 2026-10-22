import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { AuthShell } from '@/components/auth/auth-shell';
import { AdminMfaGate } from '@/components/security/admin-mfa-gate';
import { getMe } from '@/lib/session';

export const metadata: Metadata = { title: 'Verificação em duas etapas' };

/** PIE S-05: mandatory authenticator for super admins before the admin panel opens. */
export default async function AdminSecurityPage() {
  const me = await getMe();
  if (!me) redirect('/entrar?next=/admin');
  if (me.user.role !== 'SUPER_ADMIN') redirect('/app/configuracoes');
  if (me.user.mfaVerified) redirect('/admin');
  const enrolled = me.user.twoFactorEnabled;
  return (
    <AuthShell
      title="Verificação em duas etapas"
      description={
        enrolled
          ? 'Confirme o código do app autenticador para abrir o painel admin.'
          : 'O painel admin exige um app autenticador além da senha.'
      }
    >
      <AdminMfaGate enrolled={enrolled} />
    </AuthShell>
  );
}
