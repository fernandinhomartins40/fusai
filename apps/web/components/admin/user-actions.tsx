'use client';

import { Button } from '@fusai/ui/components/button';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { ImpersonateButton } from '@/components/admin/impersonate-button';
import type { AdminUser } from '@/lib/admin-types';
import { ApiError, apiFetch } from '@/lib/api';

/** Ban / unban, sign out everywhere and "entrar como". Super admins only get sign-out. */
export function UserActions({ user }: { user: AdminUser }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function run(path: string, body: object | undefined, success: string) {
    setBusy(true);
    try {
      await apiFetch(`/internal/admin/users/${user.id}/${path}`, {
        method: 'POST',
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      toast.success(success);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Não foi possível concluir.');
    } finally {
      setBusy(false);
    }
  }

  function ban() {
    const reason = prompt(
      `Bloquear ${user.email}? Ele sai de todas as sessões e não consegue mais entrar.\n\nMotivo (fica na auditoria):`,
    );
    if (reason === null) return;
    if (reason.trim().length < 5) {
      toast.error('Descreva o motivo (mínimo 5 caracteres).');
      return;
    }
    void run('ban', { reason: reason.trim() }, 'Usuário bloqueado');
  }

  const admin = user.role === 'SUPER_ADMIN';
  return (
    <div className="flex flex-wrap justify-end gap-1">
      {!admin && !user.banned ? <ImpersonateButton userId={user.id} name={user.name} /> : null}
      <Button
        size="sm"
        variant="ghost"
        disabled={busy}
        onClick={() => {
          if (confirm(`Encerrar todas as sessões de ${user.email}?`))
            void run('revoke-sessions', undefined, 'Sessões encerradas');
        }}
      >
        Desconectar
      </Button>
      {admin ? null : user.banned ? (
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => run('unban', undefined, 'Usuário desbloqueado')}
        >
          Desbloquear
        </Button>
      ) : (
        <Button
          size="sm"
          variant="ghost"
          className="text-destructive"
          disabled={busy}
          onClick={ban}
        >
          Bloquear
        </Button>
      )}
    </div>
  );
}
