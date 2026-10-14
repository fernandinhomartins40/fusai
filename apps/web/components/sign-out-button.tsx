'use client';

import { Button } from '@fuseai/ui/components/button';
import { LogOut } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { authClient } from '@/lib/auth-client';

export function SignOutButton() {
  const router = useRouter();
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={async () => {
        await authClient.signOut();
        router.replace('/entrar');
        router.refresh();
      }}
    >
      <LogOut />
      Sair
    </Button>
  );
}
