'use client';

import { brlToMicros } from '@fusai/shared';
import { Button } from '@fusai/ui/components/button';
import { Input } from '@fusai/ui/components/input';
import { Select } from '@fusai/ui/components/select';
import { Textarea } from '@fusai/ui/components/textarea';
import { Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { Field, FormAlert } from '@/components/form-field';
import { billingTypeLabel } from '@/lib/admin-labels';
import { ApiError, apiFetch } from '@/lib/api';
import { microsToInput } from '@/lib/format';

type Org = {
  id: string;
  name: string;
  status: 'ACTIVE' | 'SUSPENDED';
  billingType: keyof typeof billingTypeLabel;
  creditLimitMicros: string;
  markupOverride: string | null;
};

/** Account settings only the super admin changes: status, billing type, limit, special markup. */
export function OrgAccountForm({ org, defaultMarkup }: { org: Org; defaultMarkup: string }) {
  const router = useRouter();
  const [status, setStatus] = useState(org.status);
  const [billingType, setBillingType] = useState(org.billingType);
  const [limit, setLimit] = useState(microsToInput(org.creditLimitMicros));
  const [markup, setMarkup] = useState(org.markupOverride?.replace('.', ',') ?? '');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const suspending = status === 'SUSPENDED' && org.status !== 'SUSPENDED';

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    let creditLimitMicros: string;
    try {
      creditLimitMicros = limit.trim() ? brlToMicros(limit).toString() : '0';
    } catch {
      return setError('Limite inválido. Use o formato 100,00.');
    }
    if (suspending && reason.trim().length < 5)
      return setError('Descreva o motivo da suspensão (mínimo 5 caracteres).');
    if (suspending && !confirm(`Suspender ${org.name}? As chamadas de API passam a receber 403.`))
      return;

    setPending(true);
    try {
      await apiFetch(`/internal/admin/organizations/${org.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          status,
          billingType,
          creditLimitMicros,
          markupOverride: markup.trim() ? markup.trim() : null,
          ...(reason.trim() ? { reason: reason.trim() } : {}),
        }),
      });
      toast.success('Conta atualizada');
      setReason('');
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível salvar.');
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-4">
      {error ? <FormAlert>{error}</FormAlert> : null}
      <Field id="org-status" label="Situação">
        <Select
          id="org-status"
          value={status}
          onChange={(e) => setStatus(e.target.value as Org['status'])}
        >
          <option value="ACTIVE">Ativa</option>
          <option value="SUSPENDED">Suspensa (API bloqueada)</option>
        </Select>
      </Field>
      {suspending ? (
        <Field id="org-reason" label="Motivo da suspensão" hint="Fica registrado na auditoria.">
          <Textarea
            id="org-reason"
            rows={2}
            maxLength={300}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            required
          />
        </Field>
      ) : null}
      <Field
        id="org-billing"
        label="Tipo de cobrança"
        hint="Pré-pago: só consome o saldo já pago. Interno: não é cobrado (contas da casa)."
      >
        <Select
          id="org-billing"
          value={billingType}
          onChange={(e) => setBillingType(e.target.value as Org['billingType'])}
        >
          {Object.entries(billingTypeLabel)
            // Pós-pago desativado (D-128): ninguém consome fiado.
            .filter(([value]) => value !== 'POSTPAID' || org.billingType === 'POSTPAID')
            .map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
        </Select>
      </Field>
      {billingType === 'POSTPAID' ? (
        <Field
          id="org-limit"
          label="Limite de crédito (R$)"
          hint="Quanto o saldo pode ficar negativo."
        >
          <Input
            id="org-limit"
            inputMode="decimal"
            placeholder="0,00"
            value={limit}
            onChange={(e) => setLimit(e.target.value)}
            className="font-mono"
          />
        </Field>
      ) : null}
      <Field
        id="org-markup"
        label="Margem especial (multiplicador)"
        hint={`Vazio = margem global (${defaultMarkup.replace('.', ',')}×). Vale para os modelos com preço automático.`}
      >
        <Input
          id="org-markup"
          inputMode="decimal"
          placeholder={defaultMarkup.replace('.', ',')}
          value={markup}
          onChange={(e) => setMarkup(e.target.value)}
          className="font-mono"
        />
      </Field>
      <Button type="submit" variant={suspending ? 'destructive' : 'brand'} disabled={pending}>
        {pending ? <Loader2 className="animate-spin" /> : null}
        {suspending ? 'Suspender conta' : 'Salvar'}
      </Button>
    </form>
  );
}
