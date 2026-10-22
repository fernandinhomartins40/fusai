'use client';

import { brlToMicros, formatBRL, microsToBrl } from '@fusai/shared';
import { Button } from '@fusai/ui/components/button';
import { Input } from '@fusai/ui/components/input';
import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import { Field, FormAlert } from '@/components/form-field';
import { ApiError, apiFetch } from '@/lib/api';
import type { ApiKeyInfo } from '@/lib/api-key-types';
import { SCOPE_INFO } from './scope-picker';

/** "12.500000" -> "12,50" for the input (keeps cents only when they exist). */
function limitInput(micros: string | null): string {
  if (!micros) return '';
  const [whole, fraction = ''] = microsToBrl(BigInt(micros)).split('.');
  const cents = fraction.slice(0, 2);
  return cents === '00' ? (whole ?? '') : `${whole},${cents}`;
}

type Props = { apiKey: ApiKeyInfo; onSaved: () => void };

/** Edits name and limits of an existing key; the secret and permissions do not change. */
export function EditKeyForm({ apiKey, onSaved }: Props) {
  const [name, setName] = useState(apiKey.name);
  const [rpm, setRpm] = useState(apiKey.rpmLimit?.toString() ?? '');
  const initialLimit = limitInput(apiKey.spendLimitMicros);
  const [limit, setLimit] = useState(initialLimit);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    // The input shows cents only: resend the limit only when edited, so a fraction of a cent set
    // through the API is not rounded down by saving another field.
    let spendLimitMicros: string | null | undefined;
    try {
      if (limit !== initialLimit)
        spendLimitMicros = limit.trim() ? brlToMicros(limit).toString() : null;
    } catch {
      return setError('Limite mensal inválido. Use o formato 100,00.');
    }
    setPending(true);
    try {
      await apiFetch(`/internal/api-keys/${apiKey.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          name: name.trim(),
          rpmLimit: rpm.trim() ? Number(rpm) : null,
          spendLimitMicros,
        }),
      });
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível salvar.');
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-4">
      {error ? <FormAlert>{error}</FormAlert> : null}
      <Field id="edit-key-name" label="Nome">
        <Input
          id="edit-key-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          maxLength={60}
        />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="edit-key-rpm" label="Requisições por minuto" hint="Vazio = padrão (120).">
          <Input
            id="edit-key-rpm"
            type="number"
            min={1}
            max={10000}
            value={rpm}
            onChange={(e) => setRpm(e.target.value)}
          />
        </Field>
        <Field
          id="edit-key-limit"
          label="Limite de gasto mensal (R$)"
          hint={
            apiKey.spendLimitMicros
              ? `Hoje: ${formatBRL(BigInt(apiKey.spendLimitMicros))}. Vazio = sem limite.`
              : 'Vazio = sem limite.'
          }
        >
          <Input
            id="edit-key-limit"
            inputMode="decimal"
            value={limit}
            onChange={(e) => setLimit(e.target.value)}
          />
        </Field>
      </div>
      <p className="text-muted-foreground text-xs">
        Permissões:{' '}
        {apiKey.scopes.map((s) => SCOPE_INFO[s as keyof typeof SCOPE_INFO]?.label ?? s).join(', ')}.
        Para mudar as permissões, crie uma chave nova.
      </p>
      <Button type="submit" variant="brand" disabled={pending || !name.trim()}>
        {pending ? <Loader2 className="animate-spin" /> : null}
        Salvar
      </Button>
    </form>
  );
}
