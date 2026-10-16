import { forbidden, redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { AppShell } from '@/components/shell/app-shell';
import { getMe } from '@/lib/session';

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const me = await getMe();
  if (!me) redirect('/entrar?next=/admin');
  if (me.user.role !== 'SUPER_ADMIN') forbidden();

  return (
    <AppShell variant="admin" user={{ name: me.user.name, email: me.user.email }} canSwitch>
      {children}
    </AppShell>
  );
}
