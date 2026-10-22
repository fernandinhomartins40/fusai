'use client';

import { useRouter } from 'next/navigation';
import { TwoFactorStep } from '@/components/auth/two-factor-step';
import { TwoFactorSetup } from './two-factor-setup';

/** Super admin without a TOTP-confirmed session: enroll, or confirm the code, then /admin. */
export function AdminMfaGate({ enrolled }: { enrolled: boolean }) {
  const router = useRouter();
  const done = () => {
    router.replace('/admin');
    router.refresh();
  };
  return enrolled ? (
    <TwoFactorStep submitLabel="Abrir o painel admin" onDone={done} />
  ) : (
    <TwoFactorSetup enabled={false} required onVerified={done} />
  );
}
