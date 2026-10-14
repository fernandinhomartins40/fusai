'use client';

import { Button } from '@fuseai/ui/components/button';
import { Loader2, PlugZap } from 'lucide-react';
import { useState } from 'react';
import { FormAlert } from '@/components/form-field';
import type { ConnectionTest } from '@/lib/admin-types';
import { ApiError, apiFetch } from '@/lib/api';

/** "Testar conexão": lists the upstream models with the stored key. */
export function ProviderTest({ providerId, disabled }: { providerId: string; disabled?: boolean }) {
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<ConnectionTest | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setPending(true);
    setError(null);
    setResult(null);
    try {
      setResult(
        await apiFetch<ConnectionTest>(`/internal/admin/providers/${providerId}/test`, {
          method: 'POST',
        }),
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível testar.');
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={run}
        disabled={pending || disabled}
        title={disabled ? 'Cadastre a chave para testar' : undefined}
      >
        {pending ? <Loader2 className="animate-spin" /> : <PlugZap />}
        Testar conexão
      </Button>
      <div className="w-full" aria-live="polite">
        {error ? <FormAlert>{error}</FormAlert> : null}
        {result?.ok ? (
          <div className="grid gap-2">
            <FormAlert tone="success">
              Conectado em {result.latencyMs} ms · {result.models.length} modelos disponíveis
            </FormAlert>
            {result.models.length ? (
              <details className="text-sm">
                <summary className="cursor-pointer text-muted-foreground">
                  Ver modelos do provedor
                </summary>
                <ul className="mt-2 max-h-48 overflow-y-auto rounded-xl border p-2 font-mono text-xs">
                  {result.models.map((m) => (
                    <li key={m} className="py-0.5">
                      {m}
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
          </div>
        ) : result ? (
          <FormAlert>{result.error ?? 'Falha na conexão.'}</FormAlert>
        ) : null}
      </div>
    </>
  );
}
