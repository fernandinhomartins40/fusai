import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { OrgSwitcher } from '@/components/org-switcher';
import { AppShell } from '@/components/shell/app-shell';
import { getCurrentOrg } from '@/lib/current-org';
import { getMe } from '@/lib/session';

/**
 * Customer panel shell: sidebar on desktop, native-app bottom bar on mobile.
 * Users without an organization go to onboarding.
 */
export default async function DashboardShell({ children }: { children: ReactNode }) {
  const me = await getMe();
  if (!me) redirect('/entrar?next=/app');
  const org = await getCurrentOrg(me);
  if (!org) redirect('/app/onboarding');

  return (
    <AppShell
      variant="customer"
      user={{ name: me.user.name, email: me.user.email }}
      canSwitch={me.user.role === 'SUPER_ADMIN'}
      topSlot={
        <OrgSwitcher
          orgs={me.organizations.map((o) => ({ id: o.id, name: o.name }))}
          currentId={org.id}
        />
      }
    >
      {children}
    </AppShell>
  );
}
