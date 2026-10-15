'use client';

import { brlToMicros, formatBRL, formatDocument } from '@fusai/shared';
import { Button } from '@fusai/ui/components/button';
import { Input } from '@fusai/ui/components/input';
import { Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { Field, FormAlert } from '@/components/form-field';
import { ApiError, apiFetch } from '@/lib/api';
import type { OrgSettings } from '@/lib/dashboard-types';
import { microsToInput } from '@/lib/format';

export function OrgSettingsForm({ org }: { org: OrgSettings }) {
  const router = useRouter();
  const canEdit = org.role === 'OWNER' || org.role === 'ADMIN';
  const [name, setName] = useState(org.name);
  const [document, setDocument] = useState(org.document ? formatDocument(org.document) : '');
  const [phone, setPhone] = useState(org.phone ?? '');
  const [alert, setAlert] = useState(microsToInput(org.lowBalanceAlertMicros));
  const [topup, setTopup] = useState(
    org.suggestedTopupCents != null ? microsToInput(BigInt(org.suggestedTopupCents) * 10_000n) : '',
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    let lowBalanceAlertMicros: string | null;
    let suggestedTopupCents: number | null;
    try {
      lowBalanceAlertMicros = alert.trim() ? brlToMicros(alert).toString() : null;
      suggestedTopupCents = topup.trim() ? Number(brlToMicros(topup) / 10_000n) : null;
    } catch {
      return setError('Valor em reais inválido. Use o formato 50,00.');
    }
    setSaving(true);
    try {
      await apiFetch(`/internal/organizations/${org.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          name,
          ...(document ? { document } : {}),
          ...(phone ? { phone } : {}),
          lowBalanceAlertMicros,
          suggestedTopupCents,
        }),
      });
      toast.success('Configurações salvas');
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
      {!canEdit ? (
        <FormAlert tone="success">Somente donos e admins podem alterar estes dados.</FormAlert>
      ) : null}
      <fieldset disabled={!canEdit} className="grid gap-5">
        <div className="grid gap-5 sm:grid-cols-2">
          <Field id="o-name" label="Nome da organização">
            <Input id="o-name" value={name} onChange={(e) => setName(e.target.value)} required />
          </Field>
          <Field id="o-doc" label="CPF ou CNPJ" hint="Usado nas cobranças Pix.">
            <Input
              id="o-doc"
              inputMode="numeric"
              value={document}
              onChange={(e) => setDocument(e.target.value)}
            />
          </Field>
          <Field id="o-phone" label="Telefone">
            <Input
              id="o-phone"
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </Field>
        </div>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field
            id="o-alert"
            label="Alerta de saldo baixo (R$)"
            hint={`Vazio = padrão da plataforma (${formatBRL(BigInt(org.defaultLowBalanceMicros))}).`}
          >
            <Input
              id="o-alert"
              inputMode="decimal"
              value={alert}
              onChange={(e) => setAlert(e.target.value)}
            />
          </Field>
          <Field
            id="o-topup"
            label="Recarga sugerida (R$)"
            hint={`Valor já preenchido ao recarregar. Mínimo ${formatBRL(BigInt(org.minTopupCents) * 10_000n)}.`}
          >
            <Input
              id="o-topup"
              inputMode="decimal"
              value={topup}
              onChange={(e) => setTopup(e.target.value)}
            />
          </Field>
        </div>
        {canEdit ? (
          <div className="flex justify-end">
            <Button type="submit" variant="brand" disabled={saving}>
              {saving ? <Loader2 className="animate-spin" /> : null}
              Salvar
            </Button>
          </div>
        ) : null}
      </fieldset>
    </form>
  );
}
