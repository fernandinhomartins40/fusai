'use client';

import { brlToMicros } from '@fusai/shared';
import { Button } from '@fusai/ui/components/button';
import { Input } from '@fusai/ui/components/input';
import { Switch } from '@fusai/ui/components/switch';
import { Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { Field, FormAlert } from '@/components/form-field';
import type { AdminSettings } from '@/lib/admin-types';
import { ApiError, apiFetch } from '@/lib/api';
import { microsToInput } from '@/lib/format';

type Values = {
  usdBrlRate: string;
  defaultMarkup: string;
  topupFeePct: string;
  minTopupBrl: string;
  lowBalanceBrl: string;
  welcomeBonusBrl: string;
  testKeyMaxBrl: string;
};

const comma = (v: string) => v.replace('.', ',');

export function SettingsForm({ settings }: { settings: AdminSettings }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [autoRate, setAutoRate] = useState(settings.usd_brl_auto === 'true');
  const form = useForm<Values>({
    defaultValues: {
      usdBrlRate: comma(settings.usd_brl_rate),
      defaultMarkup: comma(settings.default_markup),
      topupFeePct: comma(settings.topup_fee_pct),
      minTopupBrl: microsToInput(BigInt(settings.min_topup_cents) * 10_000n),
      lowBalanceBrl: microsToInput(settings.low_balance_threshold_micros),
      welcomeBonusBrl: microsToInput(settings.welcome_bonus_micros),
      testKeyMaxBrl: microsToInput(settings.test_key_max_output_micros),
    },
  });
  const { isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async (v) => {
    setError(null);
    let body: AdminSettings;
    try {
      body = {
        usd_brl_rate: v.usdBrlRate,
        default_markup: v.defaultMarkup,
        topup_fee_pct: v.topupFeePct,
        min_topup_cents: Number(brlToMicros(v.minTopupBrl) / 10_000n),
        low_balance_threshold_micros: brlToMicros(v.lowBalanceBrl).toString(),
        welcome_bonus_micros: brlToMicros(v.welcomeBonusBrl).toString(),
        test_key_max_output_micros: brlToMicros(v.testKeyMaxBrl).toString(),
        usd_brl_auto: autoRate ? 'true' : 'false',
      };
    } catch {
      return setError('Valor em reais inválido. Use o formato 10,00.');
    }
    try {
      await apiFetch('/internal/admin/settings', { method: 'PUT', body: JSON.stringify(body) });
      toast.success('Preços globais atualizados');
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível salvar.');
    }
  });

  return (
    <form onSubmit={onSubmit} className="grid gap-5">
      {error ? <FormAlert>{error}</FormAlert> : null}
      <div className="flex items-center justify-between gap-4 rounded-xl border p-3">
        <div className="grid gap-0.5">
          <span id="auto-rate-label" className="font-medium text-sm">
            Atualizar o câmbio automaticamente
          </span>
          <span className="text-muted-foreground text-xs">
            Todo dia útil, às 13h30, usa a cotação PTAX de venda do Banco Central. Variações acima
            de 10% não são aplicadas: você recebe um e-mail para conferir. Desligue para fixar o
            valor abaixo.
          </span>
        </div>
        <Switch
          checked={autoRate}
          onCheckedChange={setAutoRate}
          aria-labelledby="auto-rate-label"
        />
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field
          id="rate"
          label="Câmbio USD → BRL"
          hint={
            autoRate
              ? 'Atualizado pelo Banco Central. Se você mudar à mão, vale até a próxima atualização.'
              : 'Usado no preço automático de todos os modelos.'
          }
        >
          <Input
            id="rate"
            inputMode="decimal"
            required
            className="font-mono"
            {...form.register('usdBrlRate')}
          />
        </Field>
        <Field id="markup" label="Margem padrão (multiplicador)" hint="Ex.: 4 = preço 4× o custo.">
          <Input
            id="markup"
            inputMode="decimal"
            required
            className="font-mono"
            {...form.register('defaultMarkup')}
          />
        </Field>
        <Field id="fee" label="Taxa na recarga (%)" hint="0 = desligada.">
          <Input
            id="fee"
            inputMode="decimal"
            required
            className="font-mono"
            {...form.register('topupFeePct')}
          />
        </Field>
        <Field id="minTopup" label="Recarga mínima (R$)">
          <Input
            id="minTopup"
            inputMode="decimal"
            required
            className="font-mono"
            {...form.register('minTopupBrl')}
          />
        </Field>
        <Field id="lowBalance" label="Alerta de saldo baixo (R$)">
          <Input
            id="lowBalance"
            inputMode="decimal"
            required
            className="font-mono"
            {...form.register('lowBalanceBrl')}
          />
        </Field>
        <Field
          id="welcome"
          label="Bônus de boas-vindas (R$)"
          hint="Creditado ao criar a organização."
        >
          <Input
            id="welcome"
            inputMode="decimal"
            required
            className="font-mono"
            {...form.register('welcomeBonusBrl')}
          />
        </Field>
        <Field
          id="testKeyMax"
          label="Preço máximo para chaves de teste (R$ por 1M de saída)"
          hint="Chaves fai_test_ só acessam modelos até este preço."
        >
          <Input
            id="testKeyMax"
            inputMode="decimal"
            required
            className="font-mono"
            {...form.register('testKeyMaxBrl')}
          />
        </Field>
      </div>
      <div className="flex justify-end">
        <Button type="submit" variant="brand" disabled={isSubmitting}>
          {isSubmitting ? <Loader2 className="animate-spin" /> : null}
          Salvar
        </Button>
      </div>
    </form>
  );
}
