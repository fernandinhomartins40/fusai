'use client';

import { Button } from '@fusai/ui/components/button';
import { Loader2, UserRoundCog } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { authClient } from '@/lib/auth-client';

/** Shown while a super admin uses a customer account; every action is audited. */
export function ImpersonationBanner({ user }: { user: { name: string; email: string } }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function exit() {
    setPending(true);
    const { error } = await authClient.admin.stopImpersonating();
    if (error) {
      setPending(false);
      return toast.error('Não foi possível sair do modo cliente. Saia da conta e entre de novo.');
    }
    router.replace('/admin/clientes');
    router.refresh();
  }

  return (
    <div
      role="status"
      className="sticky top-14 z-20 flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-warning/40 bg-warning/15 px-4 py-2 text-sm md:top-0 md:px-8"
    >
      <UserRoundCog className="size-4 shrink-0 text-warning-foreground" aria-hidden />
      <span className="min-w-0 flex-1">
        Você está usando a conta de <strong className="font-semibold">{user.name}</strong>{' '}
        <span className="text-muted-foreground">({user.email})</span> como super admin. Tudo fica
        registrado na auditoria.
      </span>
      <Button size="sm" variant="outline" onClick={exit} disabled={pending}>
        {pending ? <Loader2 className="animate-spin" /> : null}
        Voltar ao admin
      </Button>
    </div>
  );
}
