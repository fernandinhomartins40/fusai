'use client';

import { centsToMicros, formatBRL, safeReturnUrl } from '@fuseai/shared';
import { Button } from '@fuseai/ui/components/button';
import { Card, CardContent } from '@fuseai/ui/components/card';
import { AlertCircle, ArrowLeft, CheckCircle2, Clock, Loader2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { CopyButton } from '@/components/copy-button';
import { Confetti } from '@/components/topup/confetti';
import { API_URL } from '@/lib/config';
import type { PublicCheckout } from '@/lib/end-user-types';
import { useCountdown } from '@/lib/use-countdown';

const POLL_MS = 3000;
type State =
  | { kind: 'loading' }
  | { kind: 'not_found' }
  | { kind: 'error' }
  | { kind: 'ok'; checkout: PublicCheckout };

export function HostedCheckout({
  checkoutId,
  returnUrlOverride,
}: {
  checkoutId: string;
  returnUrlOverride: string | null;
}) {
  const [state, setState] = useState<State>({ kind: 'loading' });

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/public/checkout/${encodeURIComponent(checkoutId)}`, {
        cache: 'no-store',
      });
      if (res.status === 404 || res.status === 400) return setState({ kind: 'not_found' });
      if (res.status === 429) return; // keep showing what we have; the next poll retries
      if (!res.ok) throw new Error(String(res.status));
      setState({ kind: 'ok', checkout: (await res.json()) as PublicCheckout });
    } catch {
      setState((prev) => (prev.kind === 'ok' ? prev : { kind: 'error' }));
    }
  }, [checkoutId]);

  const pending = state.kind === 'ok' && state.checkout.status === 'PENDING';
  useEffect(() => {
    void load();
  }, [load]);
  // Live status while the Pix is open (PRD §9.1 step 5: polling every 3s).
  useEffect(() => {
    if (!pending) return;
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, POLL_MS);
    return () => clearInterval(t);
  }, [pending, load]);

  if (state.kind === 'loading') {
    return (
      <Card>
        <CardContent className="grid justify-items-center gap-3 py-16" aria-busy="true">
          <Loader2 className="size-6 animate-spin text-fuse-pink" aria-hidden />
          <span className="text-muted-foreground text-sm">Carregando pagamento…</span>
        </CardContent>
      </Card>
    );
  }
  if (state.kind !== 'ok') {
    return (
      <Card>
        <CardContent className="grid justify-items-center gap-3 py-12 text-center">
          <AlertCircle className="size-10 text-muted-foreground" aria-hidden />
          <h1 className="font-semibold text-lg">
            {state.kind === 'not_found' ? 'Pagamento não encontrado' : 'Não foi possível carregar'}
          </h1>
          <p className="text-muted-foreground text-sm">
            {state.kind === 'not_found'
              ? 'Confira o link ou volte ao app e gere um novo Pix.'
              : 'Verifique sua conexão e tente de novo.'}
          </p>
          {state.kind === 'error' ? (
            <Button variant="outline" onClick={() => load()}>
              Tentar de novo
            </Button>
          ) : null}
          <ReturnButton url={returnUrlOverride} />
        </CardContent>
      </Card>
    );
  }

  const c = state.checkout;
  const returnUrl = returnUrlOverride ?? safeReturnUrl(c.returnUrl);
  return (
    <Card>
      <CardContent className="grid gap-5 py-6">
        <div className="grid gap-1 text-center">
          <span className="text-muted-foreground text-sm">{c.merchantName}</span>
          <h1 className="font-semibold text-xl">{c.packageName ?? 'Créditos'}</h1>
          <span className="font-semibold text-3xl tabular-nums">
            {formatBRL(centsToMicros(c.amountCents))}
          </span>
        </div>
        {c.status === 'PENDING' ? (
          <PendingView checkout={c} />
        ) : c.status === 'RECEIVED' || c.status === 'CONFIRMED' ? (
          <div className="relative grid justify-items-center gap-3 py-4 text-center" role="status">
            <Confetti />
            <CheckCircle2 className="size-14 text-success" aria-hidden />
            <p className="font-semibold text-lg">Pagamento confirmado!</p>
            <p className="text-muted-foreground text-sm">
              Seus créditos já estão disponíveis{returnUrl ? '. Pode voltar ao app.' : '.'}
            </p>
            <ReturnButton url={returnUrl} primary />
          </div>
        ) : (
          <div className="grid justify-items-center gap-3 py-4 text-center" role="status">
            <AlertCircle className="size-10 text-muted-foreground" aria-hidden />
            <p className="font-semibold">
              {c.status === 'REFUNDED'
                ? 'Este pagamento foi estornado.'
                : c.status === 'EXPIRED' || c.status === 'CANCELED'
                  ? 'Este Pix expirou.'
                  : 'Este Pix não está mais disponível.'}
            </p>
            {c.status !== 'REFUNDED' ? (
              <p className="text-muted-foreground text-sm">Volte ao app e gere um novo.</p>
            ) : null}
            <ReturnButton url={returnUrl} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function PendingView({ checkout: c }: { checkout: PublicCheckout }) {
  const countdown = useCountdown(c.expiresAt);
  return (
    <div className="grid gap-4">
      {c.qrBase64 ? (
        // biome-ignore lint/performance/noImgElement: base64 data URI from the PSP, not optimizable
        <img
          src={`data:image/png;base64,${c.qrBase64}`}
          alt="QR Code Pix"
          width={240}
          height={240}
          className="mx-auto size-60 rounded-xl bg-white p-2"
        />
      ) : null}
      {c.copyPaste ? (
        <div className="grid gap-2">
          <span className="font-medium text-sm">Pix copia e cola</span>
          <code className="break-all rounded-xl border bg-muted/40 px-3 py-2 font-mono text-xs">
            {c.copyPaste}
          </code>
          <CopyButton value={c.copyPaste} label="Copiar código Pix" />
        </div>
      ) : null}
      <div
        className="flex items-center justify-between gap-2 rounded-xl border p-3 text-sm"
        aria-live="polite"
      >
        <span className="flex items-center gap-2">
          <Loader2 className="size-4 animate-spin text-fuse-pink" aria-hidden />
          Aguardando pagamento…
        </span>
        {countdown ? (
          <span className="flex items-center gap-1 text-muted-foreground tabular-nums">
            <Clock className="size-3.5" aria-hidden />
            <span className="sr-only">Expira em</span> {countdown.text}
          </span>
        ) : null}
      </div>
      <p className="text-muted-foreground text-xs">
        Abra o app do seu banco, escolha Pix → Ler QR Code ou Pix copia e cola. Esta página atualiza
        sozinha. Você recebe {formatBRL(BigInt(c.creditMicros))} em créditos.
      </p>
    </div>
  );
}

function ReturnButton({ url, primary = false }: { url: string | null; primary?: boolean }) {
  if (!url) return null;
  return (
    <Button asChild variant={primary ? 'brand' : 'outline'} className="mt-1">
      <a href={url} rel="noopener noreferrer">
        <ArrowLeft /> Voltar ao app
      </a>
    </Button>
  );
}
