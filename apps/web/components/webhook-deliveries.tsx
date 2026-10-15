'use client';

import { Badge } from '@fusai/ui/components/badge';
import { Button } from '@fusai/ui/components/button';
import { Loader2, RotateCw, Send, Webhook } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { ApiError, apiFetch } from '@/lib/api';
import type { WebhookDelivery, WebhookDeliveryPage } from '@/lib/end-user-types';
import { dateTimeBR } from '@/lib/format';

const statusBadge = {
  delivered: { label: 'entregue', variant: 'success' },
  pending: { label: 'tentando', variant: 'warning' },
  failed: { label: 'falhou', variant: 'destructive' },
} as const;

type Result = { status: string; responseStatus: number | null; lastError: string | null };

function resultToast(r: Result) {
  if (r.status === 'delivered') toast.success(`Entregue (HTTP ${r.responseStatus})`);
  else toast.error(`Falhou: ${r.lastError ?? 'erro desconhecido'}`);
}

/** Delivery log of a project's webhooks, with manual resend and a test event (PRD §9.4). */
export function WebhookDeliveries({
  projectId,
  initial,
  canEdit,
}: {
  projectId: string;
  initial: WebhookDeliveryPage;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [items, setItems] = useState(initial.deliveries);
  const [cursor, setCursor] = useState(initial.nextCursor);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    setItems(initial.deliveries);
    setCursor(initial.nextCursor);
  }, [initial]);

  async function run(id: string, path: string) {
    setBusy(id);
    try {
      resultToast(await apiFetch<Result>(path, { method: 'POST' }));
      router.refresh();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Não foi possível enviar.');
    } finally {
      setBusy(null);
    }
  }

  async function loadMore() {
    if (!cursor) return;
    setBusy('more');
    try {
      const page = await apiFetch<WebhookDeliveryPage>(
        `/internal/projects/${projectId}/webhooks?cursor=${encodeURIComponent(cursor)}`,
      );
      setItems((prev) => [...prev, ...page.deliveries]);
      setCursor(page.nextCursor);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="min-w-0 truncate font-mono text-muted-foreground text-xs">
          {initial.webhookUrl ?? 'Projeto sem URL de webhook'}
        </span>
        {canEdit && initial.webhookUrl ? (
          <Button
            variant="outline"
            size="sm"
            disabled={busy !== null}
            onClick={() => run('test', `/internal/projects/${projectId}/webhooks/test`)}
          >
            {busy === 'test' ? <Loader2 className="animate-spin" /> : <Send />}
            Enviar evento de teste
          </Button>
        ) : null}
      </div>

      {items.length === 0 ? (
        <p className="py-6 text-center text-muted-foreground text-sm">
          <Webhook className="mx-auto mb-2 size-5" aria-hidden />
          Nenhuma entrega ainda. As notificações aparecerão aqui, com opção de reenviar.
        </p>
      ) : (
        <ul className="grid divide-y rounded-xl border">
          {items.map((d) => (
            <DeliveryRow
              key={d.id}
              d={d}
              busy={busy === d.id}
              disabled={busy !== null}
              onResend={
                canEdit
                  ? () => run(d.id, `/internal/projects/${projectId}/webhooks/${d.id}/resend`)
                  : undefined
              }
            />
          ))}
        </ul>
      )}
      {cursor ? (
        <Button
          variant="outline"
          onClick={loadMore}
          disabled={busy !== null}
          className="justify-self-center"
        >
          {busy === 'more' ? <Loader2 className="animate-spin" /> : null}
          Carregar mais
        </Button>
      ) : null}
    </div>
  );
}

function DeliveryRow({
  d,
  busy,
  disabled,
  onResend,
}: {
  d: WebhookDelivery;
  busy: boolean;
  disabled: boolean;
  onResend?: () => void;
}) {
  const badge = statusBadge[d.status];
  return (
    <li className="grid gap-2 p-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <code className="font-mono text-sm">{d.event}</code>
        <Badge variant={badge.variant}>{badge.label}</Badge>
        <span className="text-muted-foreground text-xs">
          {dateTimeBR(d.createdAt)} · {d.attempts} {d.attempts === 1 ? 'tentativa' : 'tentativas'}
          {d.responseStatus ? ` · HTTP ${d.responseStatus}` : ''}
        </span>
        {onResend ? (
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto"
            disabled={disabled}
            onClick={onResend}
          >
            {busy ? <Loader2 className="animate-spin" /> : <RotateCw />}
            Reenviar
          </Button>
        ) : null}
      </div>
      {d.lastError && d.status !== 'delivered' ? (
        <p className="text-destructive text-xs">
          {d.lastError}
          {d.nextAttemptAt ? ` · próxima tentativa ${dateTimeBR(d.nextAttemptAt)}` : ''}
        </p>
      ) : null}
      <details className="text-xs">
        <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
          Ver corpo enviado
        </summary>
        <pre className="mt-2 overflow-x-auto rounded-lg bg-muted/50 p-3 font-mono">
          {JSON.stringify(d.payload, null, 2)}
        </pre>
      </details>
    </li>
  );
}
