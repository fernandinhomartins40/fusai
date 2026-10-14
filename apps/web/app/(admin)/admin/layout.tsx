import { forbidden, redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { AppHeader, NavLink } from '@/components/app-header';
import { getMe } from '@/lib/session';

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const me = await getMe();
  if (!me) redirect('/entrar?next=/admin');
  if (me.user.role !== 'SUPER_ADMIN') forbidden();

  return (
    <div className="min-h-dvh">
      <AppHeader home="/admin" userName={me.user.name} badge="Super admin">
        <NavLink href="/app">Painel do cliente</NavLink>
      </AppHeader>
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">{children}</main>
    </div>
  );
}
