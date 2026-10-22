'use client';

import { Button } from '@fusai/ui/components/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@fusai/ui/components/card';
import { Input } from '@fusai/ui/components/input';
import { Download, Loader2 } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { confirmAction } from '@/components/confirm';
import { Field, FormAlert } from '@/components/form-field';
import { ApiError, apiFetch } from '@/lib/api';
import { API_URL } from '@/lib/config';

type DeletionStatus = {
  requestedAt: string | null;
  scheduledFor: string | null;
  blockers: { code: string; message: string }[];
};

const dateBR = (iso: string) =>
  new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });

/** LGPD self-service: export my data and request (or cancel) the deletion of my account. */
export function PrivacySection() {
  const [status, setStatus] = useState<DeletionStatus | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [confirmEmail, setConfirmEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<DeletionStatus>('/internal/privacy/deletion')
      .then(setStatus)
      .catch(() => setLoadError(true));
  }, []);

  async function exportData() {
    setExporting(true);
    try {
      const res = await fetch(`${API_URL}/internal/privacy/export`, { credentials: 'include' });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error?.message ?? 'Não foi possível exportar.');
      }
      const url = URL.createObjectURL(await res.blob());
      const link = document.createElement('a');
      link.href = url;
      link.download = `fusai-meus-dados-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      // Revoking right after click() cancels the download in Safari and Firefox.
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast.success('Arquivo com seus dados baixado');
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setExporting(false);
    }
  }

  async function requestDeletion(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    const ok = await confirmAction(
      'Excluir sua conta? Ela será anonimizada em 7 dias. Até lá você pode cancelar aqui mesmo.',
      { confirmLabel: 'Pedir exclusão', destructive: true },
    );
    if (!ok) return;
    setBusy(true);
    try {
      setStatus(
        await apiFetch<DeletionStatus>('/internal/privacy/deletion', {
          method: 'POST',
          body: JSON.stringify({ confirmEmail }),
        }),
      );
      setConfirmEmail('');
      toast.success('Pedido de exclusão registrado. Enviamos um email de confirmação.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível registrar o pedido.');
    } finally {
      setBusy(false);
    }
  }

  async function cancelDeletion() {
    setBusy(true);
    try {
      setStatus(await apiFetch<DeletionStatus>('/internal/privacy/deletion', { method: 'DELETE' }));
      toast.success('Exclusão cancelada. Sua conta continua ativa.');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Não foi possível cancelar.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Privacidade</CardTitle>
        <CardDescription>
          Seus dados pessoais, conforme a <Link href="/privacidade">Política de privacidade</Link>.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-8">
        <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-center">
          <div className="grid gap-1">
            <h3 className="font-medium text-sm">Exportar meus dados</h3>
            <p className="text-muted-foreground text-sm">
              Arquivo JSON com sua conta, as organizações das quais você é dono, chaves (só o
              prefixo), pagamentos, extrato e consumo por mês. Nunca inclui senhas ou chaves
              completas.
            </p>
          </div>
          <Button variant="outline" onClick={exportData} disabled={exporting}>
            {exporting ? <Loader2 className="animate-spin" /> : <Download />}
            Exportar
          </Button>
        </div>

        <div className="grid gap-3 border-t pt-6">
          <h3 className="font-medium text-sm">Excluir minha conta</h3>
          {loadError ? (
            <FormAlert>
              Não foi possível carregar o status da exclusão. Recarregue a página.
            </FormAlert>
          ) : !status ? (
            <Loader2
              className="size-4 animate-spin text-muted-foreground"
              aria-label="Carregando"
            />
          ) : status.requestedAt && status.scheduledFor ? (
            <div className="grid gap-3">
              <FormAlert tone="info">
                Sua conta será excluída em <strong>{dateBR(status.scheduledFor)}</strong>. Até lá
                você pode cancelar.
              </FormAlert>
              {status.blockers.length > 0 ? (
                <FormAlert tone="info">
                  A exclusão só acontece depois que isto for resolvido:{' '}
                  {status.blockers.map((b) => b.message).join(' ')}
                </FormAlert>
              ) : null}
              <div>
                <Button variant="outline" onClick={cancelDeletion} disabled={busy}>
                  {busy ? <Loader2 className="animate-spin" /> : null}
                  Cancelar exclusão
                </Button>
              </div>
            </div>
          ) : (
            <form onSubmit={requestDeletion} className="grid gap-4">
              <p className="text-muted-foreground text-sm">
                Seu nome, email e logins são apagados 7 dias depois do pedido. Pagamentos e extrato
                ficam guardados pelo prazo legal, sem ligação com você. Organizações em que você é o
                único dono são desativadas e as chaves delas, revogadas.
              </p>
              {status.blockers.length > 0 ? (
                <FormAlert tone="info">
                  Antes de excluir: {status.blockers.map((b) => b.message).join(' ')}
                </FormAlert>
              ) : null}
              {error ? <FormAlert>{error}</FormAlert> : null}
              <fieldset disabled={status.blockers.length > 0 || busy} className="grid gap-4">
                <Field id="confirm-email" label="Digite o email da sua conta para confirmar">
                  <Input
                    id="confirm-email"
                    type="email"
                    autoComplete="off"
                    value={confirmEmail}
                    onChange={(e) => setConfirmEmail(e.target.value)}
                    required
                  />
                </Field>
                <div>
                  <Button type="submit" variant="destructive">
                    {busy ? <Loader2 className="animate-spin" /> : null}
                    Excluir minha conta
                  </Button>
                </div>
              </fieldset>
            </form>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
