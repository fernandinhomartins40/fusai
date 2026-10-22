'use client';

import type { ApiKeyScopeValue } from '@fusai/shared';
import { ChevronRight } from 'lucide-react';

/** What each scope allows, in plain words (O-12). */
export const SCOPE_INFO: Record<ApiKeyScopeValue, { label: string; hint: string }> = {
  chat: { label: 'Chat com a IA', hint: 'Respostas da IA e lista de modelos.' },
  'billing:read': { label: 'Ver saldo e consumo', hint: 'Consultar saldo e gasto do projeto.' },
  checkout: { label: 'Cobranças Pix', hint: 'Criar checkouts e recargas pagas com Pix.' },
  app_users: {
    label: 'Usuários finais',
    hint: 'Cadastrar usuários do seu app e emitir session tokens.',
  },
  mcp: {
    label: 'MCP (IA de programação)',
    hint: 'Sua IA de programação configura este projeto: pacotes, webhook e chaves.',
  },
};

const ORDER = Object.keys(SCOPE_INFO) as ApiKeyScopeValue[];

type Props = { value: ApiKeyScopeValue[]; onChange: (scopes: ApiKeyScopeValue[]) => void };

/** "Avançado": the key starts with the minimum; extra permissions are opt-in. */
export function ScopePicker({ value, onChange }: Props) {
  const toggle = (scope: ApiKeyScopeValue, on: boolean) => {
    const next = on ? [...value, scope] : value.filter((s) => s !== scope);
    if (next.length > 0) onChange(ORDER.filter((s) => next.includes(s)));
  };
  const extras = value.filter((s) => s !== 'chat').length;

  return (
    <details className="group rounded-xl border p-3">
      <summary className="flex cursor-pointer list-none items-center gap-1 font-medium text-sm">
        <ChevronRight className="size-4 transition-transform group-open:rotate-90" aria-hidden />
        Avançado: permissões da chave
        <span className="font-normal text-muted-foreground">
          {extras > 0 ? `(${value.length} marcadas)` : '(só chat)'}
        </span>
      </summary>
      <fieldset className="mt-3 grid gap-2">
        <legend className="sr-only">Permissões da chave</legend>
        <p className="text-muted-foreground text-xs">
          Marque só o que o app precisa. Se a chave vazar, ela não faz mais do que isso.
        </p>
        {ORDER.map((scope) => {
          const id = `scope-${scope.replace(':', '-')}`;
          return (
            <label key={scope} htmlFor={id} className="flex cursor-pointer items-start gap-2">
              <input
                id={id}
                type="checkbox"
                checked={value.includes(scope)}
                disabled={value.length === 1 && value.includes(scope)}
                onChange={(e) => toggle(scope, e.target.checked)}
                className="mt-1 accent-[var(--fusai-accent)]"
              />
              <span className="grid">
                <span className="text-sm">{SCOPE_INFO[scope].label}</span>
                <span className="text-muted-foreground text-xs">{SCOPE_INFO[scope].hint}</span>
              </span>
            </label>
          );
        })}
      </fieldset>
    </details>
  );
}
