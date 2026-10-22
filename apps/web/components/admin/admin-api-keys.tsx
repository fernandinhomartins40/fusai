'use client';

import { Badge } from '@fusai/ui/components/badge';
import { Button } from '@fusai/ui/components/button';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { confirmAction } from '@/components/confirm';
import type { AdminApiKey } from '@/lib/admin-types';
import { ApiError, apiFetch } from '@/lib/api';
import { dateTimeBR } from '@/lib/format';

/** The customer's API keys (prefix only) with an emergency revoke. */
export function AdminApiKeys({ keys }: { keys: AdminApiKey[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);

  async function revoke(key: AdminApiKey) {
    const ok = await confirmAction(
      `Revogar a chave "${key.name}" (${key.prefix}…)? Os apps que usam esta chave param na hora.`,
      { confirmLabel: 'Revogar', destructive: true },
    );
    if (!ok) return;
    setBusy(key.id);
    try {
      await apiFetch(`/internal/admin/api-keys/${key.id}/revoke`, { method: 'POST' });
      toast.success('Chave revogada');
      router.refresh();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Não foi possível revogar.');
    } finally {
      setBusy(null);
    }
  }

  if (keys.length === 0) return <p className="text-muted-foreground text-sm">Nenhuma chave.</p>;
  return (
    <ul className="grid gap-3 text-sm">
      {keys.map((k) => (
        <li key={k.id} className="flex items-start justify-between gap-2">
          <span className="grid min-w-0 gap-0.5">
            <span className="flex flex-wrap items-center gap-1.5">
              <span className="truncate font-medium">{k.name}</span>
              <Badge variant={k.env === 'LIVE' ? 'outline' : 'secondary'}>
                {k.env === 'LIVE' ? 'produção' : 'teste'}
              </Badge>
              {k.revokedAt ? <Badge variant="destructive">revogada</Badge> : null}
            </span>
            <code className="font-mono text-muted-foreground text-xs">{k.prefix}…</code>
            <span className="text-muted-foreground text-xs">
              {k.project.name} ·{' '}
              {k.lastUsedAt ? `usada ${dateTimeBR(k.lastUsedAt)}` : 'nunca usada'}
            </span>
          </span>
          {k.revokedAt ? null : (
            <Button
              size="sm"
              variant="ghost"
              className="text-destructive"
              onClick={() => revoke(k)}
              disabled={busy === k.id}
            >
              Revogar
            </Button>
          )}
        </li>
      ))}
    </ul>
  );
}
