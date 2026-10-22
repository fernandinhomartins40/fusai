'use client';

import { brlToMicros } from '@fusai/shared';
import { Badge } from '@fusai/ui/components/badge';
import { Button } from '@fusai/ui/components/button';
import { Dialog } from '@fusai/ui/components/dialog';
import { Input } from '@fusai/ui/components/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@fusai/ui/components/table';
import { Loader2, Search, Users } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Field, FormAlert } from '@/components/form-field';
import { ApiError, apiFetch } from '@/lib/api';
import type { AppUserInfo, AppUserPage } from '@/lib/end-user-types';
import { brl, dateTimeBR, intBR } from '@/lib/format';

type Props = { projectId: string; query: string; initial: AppUserPage; canAdjust: boolean };

/** "Usuários finais": end users of the customer's app, with balance and manual adjustment. */
export function AppUsersPanel({ projectId, query, initial, canAdjust }: Props) {
  const router = useRouter();
  const [users, setUsers] = useState(initial.appUsers);
  const [cursor, setCursor] = useState(initial.nextCursor);
  const [loading, setLoading] = useState(false);
  const [adjusting, setAdjusting] = useState<AppUserInfo | null>(null);
  const [unblocking, setUnblocking] = useState<string | null>(null);

  async function unblock(user: AppUserInfo) {
    setUnblocking(user.id);
    try {
      const updated = await apiFetch<AppUserInfo>(
        `/internal/projects/${projectId}/app-users/${user.id}/unblock`,
        { method: 'POST' },
      );
      setUsers((prev) => prev.map((u) => (u.id === updated.id ? updated : u)));
      toast.success('Usuário desbloqueado');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Não foi possível desbloquear.');
    } finally {
      setUnblocking(null);
    }
  }

  // A refresh or a new search brings a new first page.
  useEffect(() => {
    setUsers(initial.appUsers);
    setCursor(initial.nextCursor);
  }, [initial]);

  async function loadMore() {
    if (!cursor) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({ cursor, ...(query ? { q: query } : {}) });
      const page = await apiFetch<AppUserPage>(
        `/internal/projects/${projectId}/app-users?${params}`,
      );
      setUsers((prev) => [...prev, ...page.appUsers]);
      setCursor(page.nextCursor);
    } catch {
      toast.error('Não foi possível carregar mais.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="grid gap-4">
      <div className="grid gap-0.5">
        <h2 className="font-semibold text-lg">Usuários finais</h2>
        <p className="text-muted-foreground text-sm">
          {intBR(initial.total)} {initial.total === 1 ? 'usuário' : 'usuários'} do seu app. Eles são
          criados pelo seu backend com <code className="font-mono">POST /v1/app-users</code>.
        </p>
      </div>

      <search>
        <form className="flex gap-2" action="">
          <label htmlFor="app-user-q" className="sr-only">
            Buscar usuário
          </label>
          <Input
            id="app-user-q"
            name="q"
            defaultValue={query}
            placeholder="ID externo, email ou nome"
            className="max-w-sm"
          />
          <Button type="submit" variant="outline">
            <Search /> Buscar
          </Button>
        </form>
      </search>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Usuário</TableHead>
            <TableHead className="text-right">Saldo</TableHead>
            <TableHead>Criado em</TableHead>
            {canAdjust ? <TableHead className="text-right">Ações</TableHead> : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {users.length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={canAdjust ? 4 : 3}
                className="py-10 text-center text-muted-foreground"
              >
                <Users className="mx-auto mb-2 size-5" aria-hidden />
                {query ? 'Nenhum usuário encontrado.' : 'Nenhum usuário final ainda.'}
              </TableCell>
            </TableRow>
          ) : (
            users.map((u) => (
              <TableRow key={u.id}>
                <TableCell>
                  <span className="grid">
                    <span className="flex items-center gap-2 font-medium">
                      {u.name ?? u.externalId}
                      {u.blockedAt ? (
                        <Badge
                          variant="destructive"
                          title="Estornou créditos que já tinha usado: a IA recusa os pedidos dele até você desbloquear."
                        >
                          Bloqueado
                        </Badge>
                      ) : null}
                    </span>
                    <span className="font-mono text-muted-foreground text-xs">
                      {u.externalId}
                      {u.email ? ` · ${u.email}` : ''}
                    </span>
                  </span>
                </TableCell>
                <TableCell className="text-right tabular-nums">{brl(u.balanceMicros)}</TableCell>
                <TableCell className="text-muted-foreground">{dateTimeBR(u.createdAt)}</TableCell>
                {canAdjust ? (
                  <TableCell className="text-right">
                    {u.blockedAt ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => unblock(u)}
                        disabled={unblocking === u.id}
                      >
                        {unblocking === u.id ? <Loader2 className="animate-spin" /> : null}
                        Desbloquear
                      </Button>
                    ) : null}
                    <Button variant="ghost" size="sm" onClick={() => setAdjusting(u)}>
                      Ajustar saldo
                    </Button>
                  </TableCell>
                ) : null}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>

      {cursor ? (
        <Button
          variant="outline"
          onClick={loadMore}
          disabled={loading}
          className="justify-self-center"
        >
          {loading ? <Loader2 className="animate-spin" /> : null}
          Carregar mais
        </Button>
      ) : null}

      <Dialog
        open={adjusting !== null}
        onClose={() => setAdjusting(null)}
        title="Ajustar saldo"
        description={
          adjusting
            ? `${adjusting.name ?? adjusting.externalId} · saldo atual ${brl(adjusting.balanceMicros)}`
            : undefined
        }
      >
        {adjusting ? (
          <AdjustForm
            projectId={projectId}
            user={adjusting}
            onDone={(updated) => {
              setUsers((prev) => prev.map((u) => (u.id === updated.id ? updated : u)));
              setAdjusting(null);
              router.refresh();
            }}
          />
        ) : null}
      </Dialog>
    </section>
  );
}

function AdjustForm({
  projectId,
  user,
  onDone,
}: {
  projectId: string;
  user: AppUserInfo;
  onDone: (user: AppUserInfo) => void;
}) {
  const [kind, setKind] = useState<'add' | 'remove'>('add');
  // One key per dialog: a double click or a retry applies the adjustment only once.
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    let micros: bigint;
    try {
      micros = brlToMicros(amount);
    } catch {
      return setError('Valor inválido. Use o formato 10,00.');
    }
    if (micros <= 0n) return setError('Informe um valor maior que zero.');
    setPending(true);
    try {
      const updated = await apiFetch<AppUserInfo>(
        `/internal/projects/${projectId}/app-users/${user.id}/adjust`,
        {
          method: 'POST',
          headers: { 'Idempotency-Key': idempotencyKey },
          body: JSON.stringify({
            amountMicros: (kind === 'add' ? micros : -micros).toString(),
            description: description.trim(),
          }),
        },
      );
      toast.success('Saldo ajustado');
      onDone(updated);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível ajustar.');
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-4">
      {error ? <FormAlert>{error}</FormAlert> : null}
      <fieldset className="grid grid-cols-2 gap-2">
        <legend className="mb-2 font-medium text-sm">Tipo</legend>
        {(
          [
            ['add', 'Dar bônus'],
            ['remove', 'Remover créditos'],
          ] as const
        ).map(([value, label]) => (
          <label
            key={value}
            className="flex cursor-pointer items-center gap-2 rounded-xl border p-3 text-sm hover:bg-accent/50 has-[:checked]:border-fusai-accent/60 has-[:checked]:bg-accent/40"
          >
            <input
              type="radio"
              name="adjust-kind"
              value={value}
              checked={kind === value}
              onChange={() => setKind(value)}
              className="accent-[var(--fusai-accent)]"
            />
            {label}
          </label>
        ))}
      </fieldset>
      <Field
        id="adjust-amount"
        label="Valor (R$)"
        hint={kind === 'add' ? 'O bônus sai do saldo da sua organização.' : undefined}
      >
        <Input
          id="adjust-amount"
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          required
        />
      </Field>
      <Field id="adjust-desc" label="Motivo" hint="Aparece no extrato do usuário.">
        <Input
          id="adjust-desc"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          required
          minLength={3}
          maxLength={200}
        />
      </Field>
      <Button type="submit" variant="brand" disabled={pending}>
        {pending ? <Loader2 className="animate-spin" /> : null}
        Confirmar ajuste
      </Button>
    </form>
  );
}
