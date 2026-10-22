'use client';

import { brlToMicros } from '@fusai/shared';
import { Button } from '@fusai/ui/components/button';
import { Card, CardContent, CardHeader, CardTitle } from '@fusai/ui/components/card';
import { Input } from '@fusai/ui/components/input';
import { Select } from '@fusai/ui/components/select';
import { Switch } from '@fusai/ui/components/switch';
import { Textarea } from '@fusai/ui/components/textarea';
import { cn } from '@fusai/ui/lib/utils';
import { Loader2, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { type ReactNode, useState } from 'react';
import { toast } from 'sonner';
import { confirmAction } from '@/components/confirm';
import { Field, FormAlert } from '@/components/form-field';
import type { AdminModel, AdminProvider, AdminSettings } from '@/lib/admin-types';
import { ApiError, apiFetch } from '@/lib/api';
import { microsToInput } from '@/lib/format';
import { type PriceDraft, PricePreview } from './price-preview';

type Draft = PriceDraft & {
  slug: string;
  displayName: string;
  description: string;
  providerId: string;
  upstreamModel: string;
  contextWindow: string;
  maxOutputTokens: string;
  supportsTools: boolean;
  supportsVision: boolean;
  supportsReasoning: boolean;
  fallbackModelIds: string[];
  active: boolean;
  public: boolean;
  sortOrder: string;
};

function initialDraft(model?: AdminModel): Draft {
  return {
    slug: model?.slug ?? 'fuse/',
    displayName: model?.displayName ?? '',
    description: model?.description ?? '',
    providerId: model?.provider.id ?? '',
    upstreamModel: model?.upstreamModel ?? '',
    contextWindow: String(model?.contextWindow ?? 128000),
    maxOutputTokens: String(model?.maxOutputTokens ?? 8192),
    inputCostUsdPerM: model?.inputCostUsdPerM ?? '',
    cachedInputCostUsdPerM: model?.cachedInputCostUsdPerM ?? '',
    outputCostUsdPerM: model?.outputCostUsdPerM ?? '',
    priceMode: model?.priceMode ?? 'AUTO',
    markupMultiplier: model?.markupMultiplier ?? '',
    inputPriceBrl: microsToInput(model?.inputPriceMicrosPerM ?? null),
    outputPriceBrl: microsToInput(model?.outputPriceMicrosPerM ?? null),
    supportsTools: model?.supportsTools ?? false,
    supportsVision: model?.supportsVision ?? false,
    supportsReasoning: model?.supportsReasoning ?? false,
    fallbackModelIds: model?.fallbackModelIds ?? [],
    active: model?.active ?? false,
    public: model?.public ?? true,
    sortOrder: String(model?.sortOrder ?? 0),
  };
}

function toPayload(d: Draft) {
  const micros = (v: string) => (v.trim() ? brlToMicros(v).toString() : null);
  const fixed = d.priceMode === 'FIXED';
  return {
    slug: d.slug.trim(),
    displayName: d.displayName,
    description: d.description.trim() || null,
    providerId: d.providerId,
    upstreamModel: d.upstreamModel,
    contextWindow: d.contextWindow,
    maxOutputTokens: d.maxOutputTokens,
    inputCostUsdPerM: d.inputCostUsdPerM,
    cachedInputCostUsdPerM: d.cachedInputCostUsdPerM.trim() || null,
    outputCostUsdPerM: d.outputCostUsdPerM,
    priceMode: d.priceMode,
    markupMultiplier: d.markupMultiplier.trim() || null,
    inputPriceMicrosPerM: fixed ? micros(d.inputPriceBrl) : null,
    outputPriceMicrosPerM: fixed ? micros(d.outputPriceBrl) : null,
    supportsTools: d.supportsTools,
    supportsVision: d.supportsVision,
    supportsReasoning: d.supportsReasoning,
    fallbackModelIds: d.fallbackModelIds,
    active: d.active,
    public: d.public,
    sortOrder: d.sortOrder,
  };
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-5">{children}</CardContent>
    </Card>
  );
}

function Toggle({
  id,
  label,
  hint,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="grid gap-0.5">
        <span id={id} className="font-medium text-sm">
          {label}
        </span>
        {hint ? <span className="text-muted-foreground text-xs">{hint}</span> : null}
      </div>
      <Switch checked={checked} onCheckedChange={onChange} aria-labelledby={id} />
    </div>
  );
}

type Props = {
  model?: AdminModel;
  providers: AdminProvider[];
  models: AdminModel[];
  settings: AdminSettings;
};

export function ModelForm({ model, providers, models, settings }: Props) {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft>(() => initialDraft(model));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));
  const text = (key: keyof Draft) => ({
    value: draft[key] as string,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      set(key, e.target.value as never),
  });

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    let payload: ReturnType<typeof toPayload>;
    try {
      payload = toPayload(draft);
    } catch {
      return setError('Preço fixo inválido. Use o formato 14,52.');
    }
    setSaving(true);
    const send = (body: object) =>
      apiFetch(model ? `/internal/admin/models/${model.id}` : '/internal/admin/models', {
        method: model ? 'PATCH' : 'POST',
        body: JSON.stringify(body),
      });
    try {
      try {
        await send(payload);
      } catch (err) {
        // R-10: price below the provider cost needs an explicit confirmation.
        if (!(err instanceof ApiError && err.code === 'negative_margin')) throw err;
        const ok = await confirmAction(`Vender abaixo do custo? ${err.message}`, {
          confirmLabel: 'Salvar mesmo assim',
          destructive: true,
        });
        if (!ok) return;
        await send({ ...payload, allowNegativeMargin: true });
      }
      toast.success(model ? 'Modelo atualizado' : 'Modelo criado');
      router.push('/admin/modelos');
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível salvar.');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (
      !model ||
      !(await confirmAction(`Excluir o modelo ${model.displayName}?`, {
        confirmLabel: 'Excluir',
        destructive: true,
      }))
    )
      return;
    try {
      await apiFetch(`/internal/admin/models/${model.id}`, { method: 'DELETE' });
      toast.success('Modelo excluído');
      router.push('/admin/modelos');
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível excluir.');
    }
  }

  const otherModels = models.filter((m) => m.id !== model?.id);

  return (
    <form onSubmit={save} className="grid items-start gap-6 lg:grid-cols-[1fr_340px]">
      <div className="grid gap-6">
        {error ? <FormAlert>{error}</FormAlert> : null}

        <Section title="Identificação">
          <div className="grid gap-5 sm:grid-cols-2">
            <Field id="displayName" label="Nome de exibição">
              <Input id="displayName" required {...text('displayName')} />
            </Field>
            <Field id="slug" label="Slug público" hint="Ex.: fuse/deepseek-chat">
              <Input id="slug" required className="font-mono" {...text('slug')} />
            </Field>
            <Field id="providerId" label="Provedor">
              <Select id="providerId" required {...text('providerId')}>
                <option value="">Escolha…</option>
                {providers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                    {p.status !== 'ACTIVE' ? ' (desativado)' : ''}
                  </option>
                ))}
              </Select>
            </Field>
            <Field id="upstreamModel" label="Nome no provedor" hint="Ex.: deepseek-chat">
              <Input id="upstreamModel" required className="font-mono" {...text('upstreamModel')} />
            </Field>
          </div>
          <Field id="description" label="Descrição">
            <Textarea id="description" rows={2} {...text('description')} />
          </Field>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field id="contextWindow" label="Janela de contexto (tokens)">
              <Input id="contextWindow" type="number" min={1} required {...text('contextWindow')} />
            </Field>
            <Field id="maxOutputTokens" label="Máximo de saída (tokens)">
              <Input
                id="maxOutputTokens"
                type="number"
                min={1}
                required
                {...text('maxOutputTokens')}
              />
            </Field>
          </div>
        </Section>

        <Section title="Custo do provedor (US$ por 1M de tokens)">
          <p className="-mt-2 text-muted-foreground text-xs">
            Confira sempre na página oficial de preços do provedor.
          </p>
          <div className="grid gap-5 sm:grid-cols-3">
            <Field id="inputCost" label="Entrada">
              <Input
                id="inputCost"
                inputMode="decimal"
                required
                className="font-mono"
                {...text('inputCostUsdPerM')}
              />
            </Field>
            <Field id="cachedCost" label="Entrada em cache" hint="Opcional">
              <Input
                id="cachedCost"
                inputMode="decimal"
                className="font-mono"
                {...text('cachedInputCostUsdPerM')}
              />
            </Field>
            <Field id="outputCost" label="Saída">
              <Input
                id="outputCost"
                inputMode="decimal"
                required
                className="font-mono"
                {...text('outputCostUsdPerM')}
              />
            </Field>
          </div>
        </Section>

        <Section title="Preço de venda">
          <fieldset className="grid gap-2 sm:grid-cols-2">
            <legend className="sr-only">Modo de preço</legend>
            {(
              [
                ['AUTO', 'Automático', 'Custo × câmbio × margem'],
                ['FIXED', 'Fixo', 'Você define o preço em R$'],
              ] as const
            ).map(([value, title, hint]) => (
              <label
                key={value}
                className={cn(
                  'flex cursor-pointer gap-3 rounded-xl border p-3 hover:bg-accent/50',
                  draft.priceMode === value && 'border-fusai-accent/60 bg-accent/40',
                )}
              >
                <input
                  type="radio"
                  name="priceMode"
                  value={value}
                  checked={draft.priceMode === value}
                  onChange={() => set('priceMode', value)}
                  className="mt-1 accent-[var(--fusai-accent)]"
                />
                <span className="grid gap-0.5">
                  <span className="font-medium text-sm">{title}</span>
                  <span className="text-muted-foreground text-xs">{hint}</span>
                </span>
              </label>
            ))}
          </fieldset>
          {draft.priceMode === 'AUTO' ? (
            <Field
              id="markup"
              label="Multiplicador de margem"
              hint={`Deixe em branco para usar o padrão global (${settings.default_markup.replace('.', ',')}×).`}
            >
              <Input
                id="markup"
                inputMode="decimal"
                className="font-mono sm:max-w-40"
                {...text('markupMultiplier')}
              />
            </Field>
          ) : (
            <div className="grid gap-5 sm:grid-cols-2">
              <Field id="inputPrice" label="Entrada (R$ por 1M)">
                <Input
                  id="inputPrice"
                  inputMode="decimal"
                  required
                  className="font-mono"
                  {...text('inputPriceBrl')}
                />
              </Field>
              <Field id="outputPrice" label="Saída (R$ por 1M)">
                <Input
                  id="outputPrice"
                  inputMode="decimal"
                  required
                  className="font-mono"
                  {...text('outputPriceBrl')}
                />
              </Field>
            </div>
          )}
        </Section>

        <Section title="Capacidades e fallback">
          <Toggle
            id="tools"
            label="Tools / function calling"
            checked={draft.supportsTools}
            onChange={(v) => set('supportsTools', v)}
          />
          <Toggle
            id="vision"
            label="Visão (imagens)"
            checked={draft.supportsVision}
            onChange={(v) => set('supportsVision', v)}
          />
          <Toggle
            id="reasoning"
            label="Raciocínio"
            checked={draft.supportsReasoning}
            onChange={(v) => set('supportsReasoning', v)}
          />
          {otherModels.length ? (
            <fieldset className="grid gap-2">
              <legend className="mb-1 font-medium text-sm">
                Fallbacks{' '}
                <span className="font-normal text-muted-foreground">(na ordem marcada, até 5)</span>
              </legend>
              <div className="grid max-h-48 gap-1 overflow-y-auto rounded-xl border p-2">
                {otherModels.map((m) => {
                  const index = draft.fallbackModelIds.indexOf(m.id);
                  return (
                    <label
                      key={m.id}
                      className="flex items-center gap-2 rounded-lg px-2 py-1 text-sm hover:bg-accent/50"
                    >
                      <input
                        type="checkbox"
                        checked={index >= 0}
                        disabled={index < 0 && draft.fallbackModelIds.length >= 5}
                        onChange={(e) =>
                          set(
                            'fallbackModelIds',
                            e.target.checked
                              ? [...draft.fallbackModelIds, m.id]
                              : draft.fallbackModelIds.filter((id) => id !== m.id),
                          )
                        }
                        className="accent-[var(--fusai-accent)]"
                      />
                      <span className="font-mono text-xs">{m.slug}</span>
                      {index >= 0 ? (
                        <span className="ml-auto text-muted-foreground text-xs">#{index + 1}</span>
                      ) : null}
                    </label>
                  );
                })}
              </div>
            </fieldset>
          ) : null}
        </Section>

        <Section title="Publicação">
          <Toggle
            id="active"
            label="Ativo"
            hint="Disponível no gateway."
            checked={draft.active}
            onChange={(v) => set('active', v)}
          />
          <Toggle
            id="public"
            label="Público"
            hint="Aparece na landing e em /v1/models."
            checked={draft.public}
            onChange={(v) => set('public', v)}
          />
          <Field id="sortOrder" label="Ordem de exibição">
            <Input id="sortOrder" type="number" className="sm:max-w-32" {...text('sortOrder')} />
          </Field>
        </Section>

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
          {model ? (
            <Button type="button" variant="ghost" className="text-destructive" onClick={remove}>
              <Trash2 /> Excluir
            </Button>
          ) : (
            <span />
          )}
          <Button type="submit" variant="brand" disabled={saving}>
            {saving ? <Loader2 className="animate-spin" /> : null}
            Salvar modelo
          </Button>
        </div>
      </div>

      <div className="lg:sticky lg:top-20">
        <PricePreview draft={draft} settings={settings} />
      </div>
    </form>
  );
}
