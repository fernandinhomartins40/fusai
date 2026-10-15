'use client';

import { Button } from '@fusai/ui/components/button';
import { RefreshCw } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';

export function RefreshButton() {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={() => start(() => router.refresh())}
    >
      <RefreshCw className={pending ? 'animate-spin' : undefined} /> Atualizar
    </Button>
  );
}
