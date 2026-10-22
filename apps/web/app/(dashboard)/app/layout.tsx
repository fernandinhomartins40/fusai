import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { QueryProvider } from '@/components/query-provider';
import { getMe } from '@/lib/session';

/** Signed-in area. The visual shell lives in (main)/layout (panel) and onboarding/layout. */
export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const me = await getMe();
  if (!me) redirect('/entrar?next=/app');
  // A sign-in that skipped the authenticator code (Google) must confirm it first.
  if (me.user.twoFactorEnabled && !me.user.mfaVerified && !me.user.impersonatedBy)
    redirect('/seguranca?next=/app');
  return <QueryProvider>{children}</QueryProvider>;
}
