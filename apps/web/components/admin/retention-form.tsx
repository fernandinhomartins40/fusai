'use client';

import { Button } from '@fusai/ui/components/button';
import { Input } from '@fusai/ui/components/input';
import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Field, FormAlert } from '@/components/form-field';
import { ApiError, apiFetch } from '@/lib/api';

/** Log retention (LGPD). 0 = off; the deadline is a legal decision, minimum 180 days. */
export function RetentionForm({ days }: { days: number }) {
  const [value, setValue] = useState(String(days));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSaving(true);
    try {
      await apiFetch('/internal/admin/privacy/retention', {
        method: 'PUT',
        body: JSON.stringify({ days: Number(value) }),
      });
      toast.success(Number(value) ? `Retenção de ${value} dias ativada` : 'Retenção desligada');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível salvar.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={save} className="grid gap-4">
      {error ? <FormAlert>{error}</FormAlert> : null}
      <Field
        id="retention-days"
        label="Apagar logs mais antigos que (dias)"
        hint="0 = desligado. Mínimo de 180 dias. Pagamentos e extrato nunca são apagados. Defina o prazo com o jurídico."
      >
        <Input
          id="retention-days"
          inputMode="numeric"
          className="font-mono"
          value={value}
          onChange={(e) => setValue(e.target.value.replace(/\D/g, ''))}
          required
        />
      </Field>
      <div className="flex justify-end">
        <Button type="submit" variant="brand" disabled={saving}>
          {saving ? <Loader2 className="animate-spin" /> : null}
          Salvar
        </Button>
      </div>
    </form>
  );
}
