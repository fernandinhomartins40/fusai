'use client';

import { brlToMicros } from '@fuseai/shared';
import { Button } from '@fuseai/ui/components/button';
import { Input } from '@fuseai/ui/components/input';
import { cn } from '@fuseai/ui/lib/utils';
import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import { Field, FormAlert } from '@/components/form-field';
import { ApiError, apiFetch } from '@/lib/api';
import type { CreatedApiKey } from '@/lib/api-key-types';

type Props = { projectId: string; onCreated: (key: CreatedApiKey) => void; defaultName?: string };

export function CreateKeyForm({ projectId, onCreated, defaultName = '' }: Props) {
  const [name, setName] = useState(defaultName);
  const [env, setEnv] = useState<'LIVE' | 'TEST'>('LIVE');
  const [rpm, setRpm] = useState('');
  const [limit, setLimit] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    let spendLimitMicros: string | null = null;
    try {
      spendLimitMicros = limit.trim() ? brlToMicros(limit).toString() : null;
    } catch {
      return setError('Limite mensal inválido. Use o formato 100,00.');
    }
    setPending(true);
    try {
      const created = await apiFetch<CreatedApiKey>(`/internal/projects/${projectId}/api-keys`, {
        method: 'POST',
        body: JSON.stringify({
          name: name.trim(),
          env,
          rpmLimit: rpm.trim() ? Number(rpm) : null,
          spendLimitMicros,
        }),
      });
      onCreated(created);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível criar a chave.');
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-4">
      {error ? <FormAlert>{error}</FormAlert> : null}
      <Field id="key-name" label="Nome" hint="Ex.: Produção, Servidor de testes">
        <Input
          id="key-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          maxLength={60}
        />
      </Field>
      <fieldset className="grid grid-cols-2 gap-2">
        <legend className="mb-2 font-medium text-sm">Ambiente</legend>
        {(
          [
            ['LIVE', 'Produção', 'fai_live_…'],
            ['TEST', 'Teste', 'fai_test_… · só modelos baratos'],
          ] as const
        ).map(([value, title, hint]) => (
          <label
            key={value}
            className={cn(
              'flex cursor-pointer gap-2 rounded-xl border p-3 hover:bg-accent/50',
              env === value && 'border-fuse-pink/60 bg-accent/40',
            )}
          >
            <input
              type="radio"
              name="env"
              value={value}
              checked={env === value}
              onChange={() => setEnv(value)}
              className="mt-1 accent-[var(--fuse-pink)]"
            />
            <span className="grid">
              <span className="font-medium text-sm">{title}</span>
              <span className="font-mono text-muted-foreground text-xs">{hint}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="key-rpm" label="Requisições por minuto" hint="Vazio = padrão (120).">
          <Input
            id="key-rpm"
            type="number"
            min={1}
            max={10000}
            value={rpm}
            onChange={(e) => setRpm(e.target.value)}
          />
        </Field>
        <Field id="key-limit" label="Limite de gasto mensal (R$)" hint="Vazio = sem limite.">
          <Input
            id="key-limit"
            inputMode="decimal"
            value={limit}
            onChange={(e) => setLimit(e.target.value)}
          />
        </Field>
      </div>
      <Button type="submit" variant="brand" disabled={pending || !name.trim()}>
        {pending ? <Loader2 className="animate-spin" /> : null}
        Gerar chave
      </Button>
    </form>
  );
}
