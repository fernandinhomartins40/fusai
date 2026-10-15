'use client';

import { formatBRL } from '@fusai/shared';
import { Button } from '@fusai/ui/components/button';
import { Switch } from '@fusai/ui/components/switch';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@fusai/ui/components/table';
import { Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { FormAlert } from '@/components/form-field';
import { ApiError, apiFetch } from '@/lib/api';
import type { OrgModel, ProjectDetail } from '@/lib/dashboard-types';

/** Allow-list (empty = every active model) and default model of a project. */
export function AllowedModelsForm({
  project,
  models,
}: {
  project: ProjectDetail;
  models: OrgModel[];
}) {
  const router = useRouter();
  const [restrict, setRestrict] = useState(project.allowedModelIds.length > 0);
  const [allowed, setAllowed] = useState<string[]>(project.allowedModelIds);
  const [defaultId, setDefaultId] = useState<string | null>(project.defaultModelId);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const isAllowed = (id: string) => !restrict || allowed.includes(id);

  async function save() {
    setError(null);
    if (restrict && allowed.length === 0) return setError('Escolha pelo menos um modelo.');
    const allowedModelIds = restrict ? allowed : [];
    const nextDefault = defaultId && (!restrict || allowed.includes(defaultId)) ? defaultId : null;
    setSaving(true);
    try {
      await apiFetch(`/internal/projects/${project.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ allowedModelIds, defaultModelId: nextDefault }),
      });
      setDefaultId(nextDefault);
      toast.success('Modelos atualizados');
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível salvar.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="grid gap-4">
      {error ? <FormAlert>{error}</FormAlert> : null}
      <div className="flex items-center justify-between gap-4 rounded-2xl border p-4">
        <div className="grid gap-0.5">
          <span id="restrict-label" className="font-medium text-sm">
            Restringir modelos
          </span>
          <span className="text-muted-foreground text-xs">
            Desligado: o projeto pode usar todos os modelos ativos, inclusive os que forem
            adicionados depois.
          </span>
        </div>
        <Switch checked={restrict} onCheckedChange={setRestrict} aria-labelledby="restrict-label" />
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Permitido</TableHead>
            <TableHead>Modelo</TableHead>
            <TableHead className="text-right">Entrada (R$/1M)</TableHead>
            <TableHead className="text-right">Saída (R$/1M)</TableHead>
            <TableHead>Padrão</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {models.length === 0 ? (
            <TableRow>
              <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                Nenhum modelo ativo no momento.
              </TableCell>
            </TableRow>
          ) : (
            models.map((m) => (
              <TableRow key={m.id}>
                <TableCell>
                  <input
                    type="checkbox"
                    aria-label={`Permitir ${m.slug}`}
                    checked={isAllowed(m.id)}
                    disabled={!restrict}
                    onChange={(e) =>
                      setAllowed((prev) =>
                        e.target.checked ? [...prev, m.id] : prev.filter((id) => id !== m.id),
                      )
                    }
                    className="size-4 accent-[var(--fusai-accent)]"
                  />
                </TableCell>
                <TableCell>
                  <span className="grid">
                    <span className="font-medium">{m.name}</span>
                    <span className="font-mono text-muted-foreground text-xs">{m.slug}</span>
                  </span>
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatBRL(BigInt(m.inputPerM))}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatBRL(BigInt(m.outputPerM))}
                </TableCell>
                <TableCell>
                  <input
                    type="radio"
                    name="default-model"
                    aria-label={`Usar ${m.slug} como padrão`}
                    checked={defaultId === m.id}
                    disabled={!isAllowed(m.id)}
                    onChange={() => setDefaultId(m.id)}
                    className="size-4 accent-[var(--fusai-accent)]"
                  />
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
      <div className="flex flex-wrap justify-end gap-2">
        {defaultId ? (
          <Button variant="ghost" onClick={() => setDefaultId(null)}>
            Sem modelo padrão
          </Button>
        ) : null}
        <Button variant="brand" onClick={save} disabled={saving}>
          {saving ? <Loader2 className="animate-spin" /> : null}
          Salvar
        </Button>
      </div>
    </div>
  );
}
