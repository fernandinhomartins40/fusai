import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { AppHeader, NavLink } from '@/components/app-header';
import { OrgSwitcher } from '@/components/org-switcher';
import { getCurrentOrg } from '@/lib/current-org';
import { getMe } from '@/lib/session';

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const me = await getMe();
  if (!me) redirect('/entrar?next=/app');
  const org = await getCurrentOrg(me);

  return (
    <div className="min-h-dvh">
      <AppHeader
        home="/app"
        userName={me.user.name}
        actions={
          org ? (
            <OrgSwitcher
              orgs={me.organizations.map((o) => ({ id: o.id, name: o.name }))}
              currentId={org.id}
            />
          ) : null
        }
      >
        {me.user.role === 'SUPER_ADMIN' ? <NavLink href="/admin">Admin</NavLink> : null}
      </AppHeader>
      {children}
    </div>
  );
}
