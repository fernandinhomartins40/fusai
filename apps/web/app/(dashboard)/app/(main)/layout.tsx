import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { AppMobileNav, AppSidebar } from '@/components/app-nav';
import { getCurrentOrg } from '@/lib/current-org';
import { getMe } from '@/lib/session';

/** Dashboard shell: sidebar on desktop, tab bar on mobile. Users without an organization go to onboarding. */
export default async function DashboardShell({ children }: { children: ReactNode }) {
  const me = await getMe();
  if (!me) redirect('/entrar?next=/app');
  if (!(await getCurrentOrg(me))) redirect('/app/onboarding');

  return (
    <div className="mx-auto flex max-w-7xl">
      <aside className="sticky top-14 hidden h-[calc(100dvh-3.5rem)] w-56 shrink-0 overflow-y-auto border-r p-3 md:block">
        <AppSidebar />
      </aside>
      <div className="min-w-0 flex-1">
        <div className="md:hidden">
          <AppMobileNav />
        </div>
        <main className="px-4 py-8 sm:px-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
