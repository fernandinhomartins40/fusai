import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { QueryProvider } from '@/components/query-provider';
import { getMe } from '@/lib/session';

/** Signed-in area. The visual shell lives in (main)/layout (panel) and onboarding/layout. */
export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const me = await getMe();
  if (!me) redirect('/entrar?next=/app');
  return <QueryProvider>{children}</QueryProvider>;
}
