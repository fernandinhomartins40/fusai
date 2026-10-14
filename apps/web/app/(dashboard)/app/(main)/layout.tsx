import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { SectionNav } from '@/components/section-nav';
import { getMe } from '@/lib/session';

/** Pages that need an organization: send new users to onboarding first. */
export default async function OrgRequiredLayout({ children }: { children: ReactNode }) {
  const me = await getMe();
  if (!me) redirect('/entrar?next=/app');
  const org = me.organizations[0];
  if (!org || org.projects.length === 0) redirect('/app/onboarding');

  return (
    <>
      <SectionNav
        label="Seções do painel"
        items={[
          { href: '/app', label: 'Visão geral', exact: true },
          { href: '/app/projetos', label: 'Projetos' },
          { href: '/app/carteira', label: 'Carteira' },
        ]}
      />
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">{children}</main>
    </>
  );
}
