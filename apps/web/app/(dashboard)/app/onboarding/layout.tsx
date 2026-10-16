import type { ReactNode } from 'react';
import { AppHeader } from '@/components/app-header';
import { getMe } from '@/lib/session';

/** Onboarding has no organization yet: a simple top bar (logo, theme, sign out). */
export default async function OnboardingLayout({ children }: { children: ReactNode }) {
  const me = await getMe();
  return (
    <div className="min-h-dvh">
      <AppHeader home="/app/onboarding" userName={me?.user.name ?? ''} />
      {children}
    </div>
  );
}
