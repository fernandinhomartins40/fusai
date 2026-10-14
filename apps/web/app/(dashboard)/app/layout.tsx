import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { AppHeader, NavLink } from '@/components/app-header';
import { getMe } from '@/lib/session';

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const me = await getMe();
  if (!me) redirect('/entrar?next=/app');

  return (
    <div className="min-h-dvh">
      <AppHeader home="/app" userName={me.user.name}>
        {me.user.role === 'SUPER_ADMIN' ? <NavLink href="/admin">Admin</NavLink> : null}
      </AppHeader>
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">{children}</main>
    </div>
  );
}
