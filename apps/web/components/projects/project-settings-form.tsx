'use client';

import { brlToMicros } from '@fusai/shared';
import { Button } from '@fusai/ui/components/button';
import { Input } from '@fusai/ui/components/input';
import { Textarea } from '@fusai/ui/components/textarea';
import { cn } from '@fusai/ui/lib/utils';
import { Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { Field, FormAlert } from '@/components/form-field';
import { ApiError, apiFetch } from '@/lib/api';
import type { ProjectDetail } from '@/lib/dashboard-types';
import { microsToInput } from '@/lib/format';

const modes = [
  { value: 'ORG_WALLET', title: 'Eu pago o consumo', hint: 'Sai da carteira da organização.' },
  {
    value: 'END_USER_WALLET',
    title: 'Meus usuários pagam',
    hint: 'Cada usuário final compra créditos via Pix.',
  },
  {
    value: 'HYBRID',
    title: 'Híbrido (freemium)',
    hint: 'Usuário final primeiro; se não tiver saldo, a organização.',
  },
] as const;

export function ProjectSettingsForm({
  project,
  canChangeBilling,
}: {
  project: ProjectDetail;
  canChangeBilling: boolean;
}) {
  const router = useRouter();
  const [name, setName] = useState(project.name);
  const [billingMode, setBillingMode] = useState(project.billingMode);
  const [origins, setOrigins] = useState(project.allowedOrigins.join('\n'));
  const [freeCredit, setFreeCredit] = useState(microsToInput(project.freeCreditMicros));
  const [webhookUrl, setWebhookUrl] = useState(project.webhookUrl ?? '');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    let freeCreditMicros: string;
    try {
      freeCreditMicros = freeCredit.trim() ? brlToMicros(freeCredit).toString() : '0';
    } catch {
      return setError('Crédito grátis inválido. Use o formato 1,00.');
    }
    const allowedOrigins = origins
      .split(/[\n,]/)
      .map((o) => o.trim().replace(/\/+$/, ''))
      .filter(Boolean);
    setSaving(true);
    try {
      await apiFetch(`/internal/projects/${project.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          name,
          ...(canChangeBilling ? { billingMode } : {}),
          allowedOrigins,
          freeCreditMicros,
          webhookUrl: webhookUrl.trim() || null,
        }),
      });
      toast.success('Projeto atualizado');
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível salvar.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={save} className="grid gap-5">
      {error ? <FormAlert>{error}</FormAlert> : null}
      <Field id="p-name" label="Nome do projeto">
        <Input
          id="p-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          maxLength={60}
        />
      </Field>
      <fieldset className="grid gap-2" disabled={!canChangeBilling}>
        <legend className="mb-2 font-medium text-sm">
          Quem paga o consumo
          {canChangeBilling ? null : (
            <span className="ml-2 font-normal text-muted-foreground text-xs">
              (só donos e admins alteram)
            </span>
          )}
        </legend>
        <div className="grid gap-2 sm:grid-cols-3">
          {modes.map((m) => (
            <label
              key={m.value}
              className={cn(
                'flex cursor-pointer gap-2 rounded-xl border p-3 hover:bg-accent/50',
                billingMode === m.value && 'border-fusai-accent/60 bg-accent/40',
                !canChangeBilling && 'cursor-not-allowed opacity-70',
              )}
            >
              <input
                type="radio"
                name="billingMode"
                value={m.value}
                checked={billingMode === m.value}
                onChange={() => setBillingMode(m.value)}
                className="mt-1 accent-[var(--fusai-accent)]"
              />
              <span className="grid gap-0.5">
                <span className="font-medium text-sm">{m.title}</span>
                <span className="text-muted-foreground text-xs">{m.hint}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <Field
        id="p-origins"
        label="Origens permitidas (CORS)"
        hint="Uma por linha, ex.: https://app.seusite.com. Usadas quando o navegador chama a fusai com session token."
      >
        <Textarea
          id="p-origins"
          rows={3}
          value={origins}
          onChange={(e) => setOrigins(e.target.value)}
          className="font-mono text-xs"
          placeholder="https://app.seusite.com"
        />
      </Field>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field
          id="p-free"
          label="Crédito grátis para novos usuários finais (R$)"
          hint="0 = sem bônus."
        >
          <Input
            id="p-free"
            inputMode="decimal"
            value={freeCredit}
            onChange={(e) => setFreeCredit(e.target.value)}
          />
        </Field>
        <Field
          id="p-webhook"
          label="URL do webhook"
          hint="Recebe eventos de pagamento e saldo. Vazio = desligado."
        >
          <Input
            id="p-webhook"
            type="url"
            value={webhookUrl}
            onChange={(e) => setWebhookUrl(e.target.value)}
            placeholder="https://seusite.com/webhooks/fusai"
          />
        </Field>
      </div>
      <div className="flex justify-end">
        <Button type="submit" variant="brand" disabled={saving}>
          {saving ? <Loader2 className="animate-spin" /> : null}
          Salvar
        </Button>
      </div>
    </form>
  );
}
