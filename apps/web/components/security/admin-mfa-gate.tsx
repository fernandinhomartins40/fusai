'use client';

import { useRouter } from 'next/navigation';
import { TwoFactorStep } from '@/components/auth/two-factor-step';
import { TwoFactorSetup } from './two-factor-setup';

/** Session without the TOTP check: enroll (super admin) or confirm the code, then `next`. */
export function AdminMfaGate({
  enrolled,
  next = '/admin',
  submitLabel = 'Abrir o painel admin',
}: {
  enrolled: boolean;
  next?: string;
  submitLabel?: string;
}) {
  const router = useRouter();
  const done = () => {
    router.replace(next);
    router.refresh();
  };
  return enrolled ? (
    <TwoFactorStep submitLabel={submitLabel} onDone={done} />
  ) : (
    <TwoFactorSetup enabled={false} required onVerified={done} />
  );
}
