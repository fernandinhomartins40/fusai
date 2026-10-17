'use client';

import { Badge } from '@fusai/ui/components/badge';
import { Button } from '@fusai/ui/components/button';
import { Dialog } from '@fusai/ui/components/dialog';
import { Input } from '@fusai/ui/components/input';
import { Bot, Loader2, Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { CodeBlock } from '@/components/copy-button';
import { Field, FormAlert } from '@/components/form-field';
import { McpCommands } from '@/components/integration/mcp-commands';
import { ApiError, apiFetch } from '@/lib/api';
import { dateTimeBR } from '@/lib/format';

export type AgentKeyInfo = {
  id: string;
  name: string;
  prefix: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
};

/** Organization agent keys: create (shown once, already inside the MCP commands), list, revoke. */
export function AgentKeysPanel({ orgId, keys }: { orgId: string; keys: AgentKeyInfo[] }) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('Minha IA de programação');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [created, setCreated] = useState<string | null>(null);

  async function create(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setPending(true);
    try {
      const res = await apiFetch<{ key: string }>(`/internal/organizations/${orgId}/agent-keys`, {
        method: 'POST',
        body: JSON.stringify({ name: name.trim() }),
      });
      setCreating(false);
      setCreated(res.key);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível criar a chave.');
    } finally {
      setPending(false);
    }
  }

  async function revoke(key: AgentKeyInfo) {
    if (!confirm(`Revogar "${key.name}"? A IA conectada com ela perde o acesso na hora.`)) return;
    try {
      await apiFetch(`/internal/organizations/${orgId}/agent-keys/${key.id}/revoke`, {
        method: 'POST',
      });
      toast.success('Chave revogada');
      router.refresh();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Não foi possível revogar.');
    }
  }

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-semibold text-lg">Chaves de agente</h2>
        <Button variant="brand" onClick={() => setCreating(true)}>
          <Plus /> Nova chave de agente
        </Button>
      </div>

      {keys.length === 0 ? (
        <div className="grid justify-items-center gap-2 rounded-2xl border border-dashed p-8 text-center">
          <Bot className="size-6 text-muted-foreground" aria-hidden />
          <p className="text-muted-foreground text-sm">
            Nenhuma chave ainda. Crie uma e cole o comando na sua IA de programação.
          </p>
        </div>
      ) : (
        <ul className="grid gap-2">
          {keys.map((k) => (
            <li
              key={k.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border p-4"
            >
              <span className="grid min-w-0 gap-0.5">
                <span className="flex flex-wrap items-center gap-2 font-medium">
                  {k.name}
                  {k.revokedAt ? <Badge variant="destructive">revogada</Badge> : null}
                </span>
                <code className="font-mono text-muted-foreground text-xs">{k.prefix}…</code>
                <span className="text-muted-foreground text-xs">
                  Criada em {dateTimeBR(k.createdAt)} ·{' '}
                  {k.lastUsedAt ? `usada ${dateTimeBR(k.lastUsedAt)}` : 'nunca usada'}
                </span>
              </span>
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
            </li>
          ))}
        </ul>
      )}

      <Dialog
        open={creating}
        onClose={() => setCreating(false)}
        title="Nova chave de agente"
        description="Dá à sua IA acesso para configurar toda a organização. Só donos e admins criam."
      >
        <form onSubmit={create} className="grid gap-4">
          {error ? <FormAlert>{error}</FormAlert> : null}
          <Field
            id="agent-name"
            label="Nome"
            hint="Para reconhecer depois, ex.: Claude Code do notebook"
          >
            <Input
              id="agent-name"
              value={name}
              maxLength={60}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </Field>
          <Button type="submit" variant="brand" disabled={pending || name.trim().length < 2}>
            {pending ? <Loader2 className="animate-spin" /> : null}
            Criar chave
          </Button>
        </form>
      </Dialog>

      <Dialog
        open={created !== null}
        onClose={() => setCreated(null)}
        title="Chave criada: copie agora"
        description="Ela não aparece de novo. Cole o comando na sua IA; não salve a chave no código do projeto."
      >
        {created ? (
          <div className="grid gap-4">
            <CodeBlock label="Chave de agente" code={created} />
            <McpCommands apiKey={created} />
            <Button variant="outline" onClick={() => setCreated(null)}>
              Pronto, já copiei
            </Button>
          </div>
        ) : null}
      </Dialog>
    </div>
  );
}
