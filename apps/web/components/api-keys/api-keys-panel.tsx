'use client';

import { formatBRL } from '@fusai/shared';
import { Badge } from '@fusai/ui/components/badge';
import { Button } from '@fusai/ui/components/button';
import { Dialog } from '@fusai/ui/components/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@fusai/ui/components/table';
import { KeyRound, Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { ApiError, apiFetch } from '@/lib/api';
import type { ApiKeyInfo, CreatedApiKey } from '@/lib/api-key-types';
import { dateTimeBR } from '@/lib/format';
import { CreateKeyForm } from './create-key-form';
import { KeyReveal } from './key-reveal';

export function ApiKeysPanel({ projectId, keys }: { projectId: string; keys: ApiKeyInfo[] }) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<CreatedApiKey | null>(null);

  async function revoke(key: ApiKeyInfo) {
    if (
      !confirm(
        `Revogar a chave “${key.name}” (${key.prefix}…)? Apps que usam esta chave param na hora.`,
      )
    )
      return;
    try {
      await apiFetch(`/internal/api-keys/${key.id}/revoke`, { method: 'POST' });
      toast.success('Chave revogada');
      router.refresh();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Não foi possível revogar.');
    }
  }

  function close() {
    setCreating(false);
    setCreated(null);
    router.refresh();
  }

  return (
    <section className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="grid gap-0.5">
          <h2 className="font-semibold text-lg">Chaves de API</h2>
          <p className="text-muted-foreground text-sm">
            Use no servidor do seu app. A chave completa aparece só uma vez.
          </p>
        </div>
        <Button variant="brand" onClick={() => setCreating(true)}>
          <Plus /> Nova chave
        </Button>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Nome</TableHead>
            <TableHead>Chave</TableHead>
            <TableHead>Limites</TableHead>
            <TableHead>Último uso</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Ações</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {keys.length === 0 ? (
            <TableRow>
              <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                <KeyRound className="mx-auto mb-2 size-5" aria-hidden />
                Nenhuma chave ainda. Gere a primeira para começar.
              </TableCell>
            </TableRow>
          ) : (
            keys.map((k) => (
              <TableRow key={k.id} className={k.revokedAt ? 'opacity-60' : undefined}>
                <TableCell className="font-medium">{k.name}</TableCell>
                <TableCell>
                  <span className="flex items-center gap-2">
                    <code className="font-mono text-xs">{k.prefix}…</code>
                    <Badge variant={k.env === 'LIVE' ? 'outline' : 'warning'}>
                      {k.env === 'LIVE' ? 'live' : 'teste'}
                    </Badge>
                  </span>
                </TableCell>
                <TableCell className="text-muted-foreground text-xs">
                  {k.rpmLimit ?? 120} rpm
                  {k.spendLimitMicros ? ` · ${formatBRL(BigInt(k.spendLimitMicros))}/mês` : ''}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {k.lastUsedAt ? dateTimeBR(k.lastUsedAt) : 'nunca'}
                </TableCell>
                <TableCell>
                  {k.revokedAt ? (
                    <Badge variant="destructive">revogada</Badge>
                  ) : k.expiresAt && new Date(k.expiresAt) < new Date() ? (
                    <Badge variant="secondary">expirada</Badge>
                  ) : (
                    <Badge variant="success">ativa</Badge>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  {k.revokedAt ? null : (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive"
                      onClick={() => revoke(k)}
                    >
                      Revogar
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>

      <Dialog
        open={creating}
        onClose={close}
        title={created ? 'Chave criada' : 'Nova chave de API'}
        description={created ? undefined : 'Defina um nome e, se quiser, limites de uso.'}
      >
        {created ? (
          <div className="grid gap-4">
            <KeyReveal created={created} />
            <Button onClick={close}>Já copiei a chave</Button>
          </div>
        ) : (
          <CreateKeyForm projectId={projectId} onCreated={setCreated} />
        )}
      </Dialog>
    </section>
  );
}
