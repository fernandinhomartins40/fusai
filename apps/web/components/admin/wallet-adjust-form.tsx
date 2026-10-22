'use client';

import { brlToMicros, formatBRL } from '@fusai/shared';
import { Button } from '@fusai/ui/components/button';
import { Input } from '@fusai/ui/components/input';
import { Textarea } from '@fusai/ui/components/textarea';
import { cn } from '@fusai/ui/lib/utils';
import { Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { confirmAction } from '@/components/confirm';
import { Field, FormAlert } from '@/components/form-field';
import { ApiError, apiFetch } from '@/lib/api';

type Direction = 'credit' | 'debit';

/** Manual balance adjustment: always needs a reason (ledger ADJUSTMENT + audit log). */
export function WalletAdjustForm({ orgId, orgName }: { orgId: string; orgName: string }) {
  const router = useRouter();
  const [direction, setDirection] = useState<Direction>('credit');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
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
    if (reason.trim().length < 5) return setError('Descreva o motivo (mínimo 5 caracteres).');
    const signed = direction === 'credit' ? micros : -micros;
    const verb = direction === 'credit' ? 'Creditar' : 'Debitar';
    if (
      !(await confirmAction(`${verb} ${formatBRL(micros)} na carteira de ${orgName}?`, {
        confirmLabel: verb,
      }))
    )
      return;

    setPending(true);
    try {
      await apiFetch(`/internal/admin/organizations/${orgId}/wallet/adjust`, {
        method: 'POST',
        body: JSON.stringify({ amountMicros: signed.toString(), reason: reason.trim() }),
      });
      toast.success('Ajuste lançado');
      setAmount('');
      setReason('');
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível lançar o ajuste.');
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-4">
      {error ? <FormAlert>{error}</FormAlert> : null}
      <fieldset className="grid grid-cols-2 gap-2">
        <legend className="sr-only">Tipo de ajuste</legend>
        {(
          [
            ['credit', 'Crédito'],
            ['debit', 'Débito'],
          ] as const
        ).map(([value, label]) => (
          <label
            key={value}
            className={cn(
              'flex cursor-pointer items-center gap-2 rounded-xl border p-3 text-sm hover:bg-accent/50',
              direction === value && 'border-fusai-accent/60 bg-accent/40 font-medium',
            )}
          >
            <input
              type="radio"
              name="direction"
              value={value}
              checked={direction === value}
              onChange={() => setDirection(value)}
              className="accent-[var(--fusai-accent)]"
            />
            {label}
          </label>
        ))}
      </fieldset>
      <Field id="adjust-amount" label="Valor (R$)">
        <Input
          id="adjust-amount"
          inputMode="decimal"
          placeholder="10,00"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className="font-mono"
          required
        />
      </Field>
      <Field id="adjust-reason" label="Motivo" hint="Aparece no extrato do cliente e na auditoria.">
        <Textarea
          id="adjust-reason"
          rows={2}
          maxLength={300}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          required
        />
      </Field>
      <Button
        type="submit"
        variant={direction === 'debit' ? 'destructive' : 'brand'}
        disabled={pending}
      >
        {pending ? <Loader2 className="animate-spin" /> : null}
        Lançar {direction === 'credit' ? 'crédito' : 'débito'}
      </Button>
    </form>
  );
}
