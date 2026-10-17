'use client';

import { Button } from '@fusai/ui/components/button';
import { Loader2, LogIn } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { authClient } from '@/lib/auth-client';

/**
 * "Entrar como cliente": a 1-hour session as this user, with a banner and an audit trail.
 * A full page load swaps every cached view to the customer's session.
 */
export function ImpersonateButton({ userId, name }: { userId: string; name: string }) {
  const [pending, setPending] = useState(false);

  async function start() {
    if (!confirm(`Entrar no painel como ${name}? A sessão dura 1 hora e fica na auditoria.`))
      return;
    setPending(true);
    const { error } = await authClient.admin.impersonateUser({ userId });
    if (error) {
      setPending(false);
      toast.error(
        error.status === 403
          ? 'Não é possível entrar como outro super admin.'
          : 'Não foi possível entrar como este usuário.',
      );
      return;
    }
    window.location.assign('/app');
  }

  return (
    <Button size="sm" variant="outline" onClick={start} disabled={pending}>
      {pending ? <Loader2 className="animate-spin" /> : <LogIn />}
      Entrar como
    </Button>
  );
}
