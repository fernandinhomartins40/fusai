import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { OnboardingWizard } from '@/components/onboarding/onboarding-wizard';
import { getMe } from '@/lib/session';

export const metadata: Metadata = { title: 'Primeiros passos' };

export default async function OnboardingPage() {
  const me = await getMe();
  if (!me) redirect('/entrar?next=/app/onboarding');
  const org = me.organizations[0];
  if (org && org.projects.length > 0) redirect('/app');

  return (
    <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <OnboardingWizard
        userName={me.user.name.split(' ')[0] ?? ''}
        existingOrg={org ? { id: org.id, name: org.name } : null}
      />
    </main>
  );
}
