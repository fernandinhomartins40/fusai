'use client';

import { Button } from '@fusai/ui/components/button';
import { Input } from '@fusai/ui/components/input';
import { Switch } from '@fusai/ui/components/switch';
import { Loader2, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { confirmAction } from '@/components/confirm';
import { Field, FormAlert } from '@/components/form-field';
import type { AdminProvider } from '@/lib/admin-types';
import { ApiError, apiFetch } from '@/lib/api';

type Values = {
  slug: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  priority: number;
  timeoutMs: number;
};

export function ProviderForm({ provider }: { provider?: AdminProvider }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState(provider?.status === 'ACTIVE');
  const form = useForm<Values>({
    defaultValues: {
      slug: provider?.slug ?? '',
      name: provider?.name ?? '',
      baseUrl: provider?.baseUrl ?? 'https://',
      apiKey: '',
      priority: provider?.priority ?? 100,
      timeoutMs: provider?.timeoutMs ?? 120_000,
    },
  });
  const { isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async ({ slug, apiKey, ...values }) => {
    setError(null);
    const body = {
      ...values,
      status: active ? 'ACTIVE' : 'DISABLED',
      ...(apiKey ? { apiKey } : {}),
      ...(provider ? {} : { slug }),
    };
    try {
      await apiFetch(
        provider ? `/internal/admin/providers/${provider.id}` : '/internal/admin/providers',
        {
          method: provider ? 'PATCH' : 'POST',
          body: JSON.stringify(body),
        },
      );
      toast.success(provider ? 'Provedor atualizado' : 'Provedor criado');
      router.push('/admin/provedores');
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível salvar.');
    }
  });

  async function remove() {
    if (
      !provider ||
      !(await confirmAction(`Excluir o provedor ${provider.name}?`, {
        confirmLabel: 'Excluir',
        destructive: true,
      }))
    )
      return;
    try {
      await apiFetch(`/internal/admin/providers/${provider.id}`, { method: 'DELETE' });
      toast.success('Provedor excluído');
      router.push('/admin/provedores');
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível excluir.');
    }
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-5">
      {error ? <FormAlert>{error}</FormAlert> : null}
      <div className="grid gap-5 sm:grid-cols-2">
        <Field id="name" label="Nome">
          <Input id="name" required {...form.register('name')} />
        </Field>
        <Field id="slug" label="Identificador" hint="Ex.: deepseek. Não pode ser alterado depois.">
          <Input
            id="slug"
            required
            disabled={!!provider}
            className="font-mono"
            {...form.register('slug')}
          />
        </Field>
      </div>
      <Field
        id="baseUrl"
        label="Base URL (compatível com OpenAI)"
        hint="Ex.: https://api.deepseek.com/v1"
      >
        <Input
          id="baseUrl"
          type="url"
          required
          className="font-mono"
          {...form.register('baseUrl')}
        />
      </Field>
      <Field
        id="apiKey"
        label="Chave de API"
        hint={
          provider?.hasKey
            ? `Chave atual: ${provider.keyMask ?? '••••'}. Deixe em branco para manter.`
            : 'Guardada com criptografia AES-256-GCM. Nunca é exibida de novo.'
        }
      >
        <Input
          id="apiKey"
          type="password"
          autoComplete="off"
          spellCheck={false}
          className="font-mono"
          {...form.register('apiKey')}
        />
      </Field>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field id="priority" label="Prioridade" hint="Menor número = preferido.">
          <Input
            id="priority"
            type="number"
            min={0}
            {...form.register('priority', { valueAsNumber: true })}
          />
        </Field>
        <Field id="timeoutMs" label="Timeout (ms)">
          <Input
            id="timeoutMs"
            type="number"
            min={1000}
            step={1000}
            {...form.register('timeoutMs', { valueAsNumber: true })}
          />
        </Field>
      </div>
      <div className="flex items-center justify-between gap-4 rounded-xl border p-3">
        <div className="grid gap-0.5">
          <span id="active-label" className="font-medium text-sm">
            Provedor ativo
          </span>
          <span className="text-muted-foreground text-xs">Exige chave cadastrada.</span>
        </div>
        <Switch checked={active} onCheckedChange={setActive} aria-labelledby="active-label" />
      </div>
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
        {provider ? (
          <Button type="button" variant="ghost" className="text-destructive" onClick={remove}>
            <Trash2 /> Excluir
          </Button>
        ) : (
          <span />
        )}
        <Button type="submit" variant="brand" disabled={isSubmitting}>
          {isSubmitting ? <Loader2 className="animate-spin" /> : null}
          Salvar
        </Button>
      </div>
    </form>
  );
}
