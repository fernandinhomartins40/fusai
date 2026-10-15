'use client';

import { brlToMicros, centsToMicros, formatBRL } from '@fusai/shared';
import { Button } from '@fusai/ui/components/button';
import { Dialog } from '@fusai/ui/components/dialog';
import { Input } from '@fusai/ui/components/input';
import { cn } from '@fusai/ui/lib/utils';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, Clock, Loader2, Plus } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { CopyButton } from '@/components/copy-button';
import { FormAlert } from '@/components/form-field';
import { ApiError, apiFetch } from '@/lib/api';
import type { PaymentInfo, TopupOptions } from '@/lib/payment-types';
import { useCountdown } from '@/lib/use-countdown';
import { Confetti } from './confetti';

const brlCents = (cents: number) => formatBRL(centsToMicros(cents));

/** "Adicionar créditos": package or free amount → Pix QR + copy-paste → live status → success. */
export function TopupDialog({
  orgId,
  options,
  autoOpen = false,
}: {
  orgId: string;
  options: TopupOptions;
  autoOpen?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(autoOpen && options.canTopup && options.hasDocument);
  const [packageId, setPackageId] = useState<string | null>(
    options.packages.find((p) => p.highlight)?.id ?? options.packages[0]?.id ?? null,
  );
  const [custom, setCustom] = useState(
    options.suggestedTopupCents
      ? (options.suggestedTopupCents / 100).toFixed(2).replace('.', ',')
      : '',
  );
  const [mode, setMode] = useState<'package' | 'custom'>(
    options.packages.length ? 'package' : 'custom',
  );
  const [payment, setPayment] = useState<PaymentInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  // One key per dialog session: a double click never creates two charges.
  const idempotencyKey = useMemo(() => (open ? crypto.randomUUID() : ''), [open]);

  const status = useQuery({
    queryKey: ['payment', payment?.id],
    queryFn: () => apiFetch<PaymentInfo>(`/internal/payments/${payment?.id}`),
    enabled: !!payment && payment.status === 'PENDING',
    refetchInterval: (q) => (q.state.data && q.state.data.status !== 'PENDING' ? false : 3000),
  });
  const current = status.data ?? payment;
  const countdown = useCountdown(current?.status === 'PENDING' ? current.expiresAt : null);
  const paid = current?.status === 'RECEIVED' || current?.status === 'CONFIRMED';

  // Refresh the wallet behind the dialog as soon as something changes (new charge, payment
  // confirmed), so it is already up to date when the dialog closes.
  const paymentId = payment?.id;
  // biome-ignore lint/correctness/useExhaustiveDependencies: refresh on these transitions only
  useEffect(() => {
    if (paymentId) router.refresh();
  }, [paymentId, paid]);

  function close() {
    setOpen(false);
    setPayment(null);
    setError(null);
  }

  async function create() {
    setError(null);
    let body: { packageId: string } | { amountCents: number };
    if (mode === 'package' && packageId) body = { packageId };
    else {
      try {
        body = { amountCents: Number(brlToMicros(custom) / 10_000n) };
      } catch {
        return setError('Valor inválido. Use o formato 50,00.');
      }
    }
    setCreating(true);
    try {
      setPayment(
        await apiFetch<PaymentInfo>(`/internal/organizations/${orgId}/topups`, {
          method: 'POST',
          body: JSON.stringify(body),
          headers: { 'idempotency-key': idempotencyKey },
        }),
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível gerar o Pix.');
    } finally {
      setCreating(false);
    }
  }

  const disabledReason = !options.canTopup
    ? 'Só donos, admins e o financeiro podem recarregar.'
    : !options.hasDocument
      ? 'Cadastre o CPF/CNPJ da organização para gerar o Pix.'
      : null;

  return (
    <>
      <Button
        variant="brand"
        onClick={() => setOpen(true)}
        disabled={!!disabledReason}
        title={disabledReason ?? undefined}
      >
        <Plus /> Adicionar créditos
      </Button>
      {!options.hasDocument && options.canTopup ? (
        <Link href="/app/configuracoes" className="text-muted-foreground text-xs underline">
          Cadastrar CPF/CNPJ
        </Link>
      ) : null}

      <Dialog
        open={open}
        onClose={close}
        title={paid ? 'Pagamento confirmado' : payment ? 'Pague com Pix' : 'Adicionar créditos'}
        description={
          payment
            ? undefined
            : 'Escolha um pacote ou informe o valor. O crédito cai assim que o Pix é confirmado.'
        }
      >
        {error ? <FormAlert>{error}</FormAlert> : null}

        {!payment ? (
          <div className="grid gap-4">
            {options.packages.length ? (
              <fieldset className="grid grid-cols-2 gap-2">
                <legend className="sr-only">Pacotes</legend>
                {options.packages.map((p) => {
                  const selected = mode === 'package' && packageId === p.id;
                  const bonus = BigInt(p.bonusMicros);
                  return (
                    <label
                      key={p.id}
                      className={cn(
                        'relative grid cursor-pointer gap-0.5 rounded-xl border p-3 transition-colors hover:bg-accent/50 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring',
                        selected && 'border-fusai-accent/70 bg-accent/40',
                      )}
                    >
                      <input
                        type="radio"
                        name="package"
                        value={p.id}
                        checked={selected}
                        onChange={() => {
                          setMode('package');
                          setPackageId(p.id);
                        }}
                        className="sr-only"
                      />
                      {p.highlight ? (
                        <span className="absolute top-2 right-2 rounded-full bg-fusai-fill px-1.5 py-0.5 font-medium text-[10px] text-white">
                          popular
                        </span>
                      ) : null}
                      <span className="font-semibold">{brlCents(p.priceCents)}</span>
                      <span className="text-muted-foreground text-xs">
                        {formatBRL(BigInt(p.creditMicros) + bonus)} em créditos
                        {bonus > 0n ? ` (+${formatBRL(bonus)} bônus)` : ''}
                      </span>
                    </label>
                  );
                })}
              </fieldset>
            ) : null}
            <label
              htmlFor="custom-amount"
              className={cn(
                'grid gap-2 rounded-xl border p-3',
                mode === 'custom' && 'border-fusai-accent/70 bg-accent/40',
              )}
            >
              <span className="font-medium text-sm">Outro valor (R$)</span>
              <Input
                id="custom-amount"
                inputMode="decimal"
                placeholder={(options.minTopupCents / 100).toFixed(2).replace('.', ',')}
                value={custom}
                onFocus={() => setMode('custom')}
                onChange={(e) => {
                  setMode('custom');
                  setCustom(e.target.value);
                }}
              />
              <span className="text-muted-foreground text-xs">
                Mínimo {brlCents(options.minTopupCents)} · máximo {brlCents(options.maxTopupCents)}
                {Number(options.feePct) > 0
                  ? ` · taxa de ${options.feePct.replace('.', ',')}% na recarga`
                  : ''}
              </span>
            </label>
            <Button variant="brand" onClick={create} disabled={creating}>
              {creating ? <Loader2 className="animate-spin" /> : null}
              Gerar Pix
            </Button>
          </div>
        ) : paid ? (
          <div className="relative grid justify-items-center gap-3 py-6 text-center">
            <Confetti />
            <CheckCircle2 className="size-12 text-success" aria-hidden />
            <p className="font-semibold text-lg">
              {formatBRL(BigInt(current.creditMicros))} em créditos adicionados
            </p>
            <p className="text-muted-foreground text-sm">
              Já pode usar. Enviamos a confirmação por email.
            </p>
            <Button onClick={close} className="mt-2">
              Ver carteira
            </Button>
          </div>
        ) : current && current.status !== 'PENDING' ? (
          <div className="grid gap-3">
            <FormAlert>
              Este Pix {current.status === 'EXPIRED' ? 'expirou' : 'não está mais disponível'}. Gere
              um novo.
            </FormAlert>
            <Button variant="outline" onClick={() => setPayment(null)}>
              Gerar outro Pix
            </Button>
          </div>
        ) : current ? (
          <div className="grid gap-4">
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-semibold text-2xl">{brlCents(current.amountCents)}</span>
              <span className="text-muted-foreground text-sm">
                {formatBRL(BigInt(current.creditMicros))} em créditos
              </span>
            </div>
            {current.pixQrBase64 ? (
              // biome-ignore lint/performance/noImgElement: base64 data URI from the PSP, not optimizable
              <img
                src={`data:image/png;base64,${current.pixQrBase64}`}
                alt="QR Code Pix"
                width={220}
                height={220}
                className="mx-auto size-56 rounded-xl bg-white p-2"
              />
            ) : null}
            {current.pixCopyPaste ? (
              <div className="grid gap-2">
                <span className="font-medium text-sm">Pix copia e cola</span>
                <div className="flex items-center gap-2">
                  <code className="min-w-0 flex-1 truncate rounded-xl border bg-muted/40 px-3 py-2 font-mono text-xs">
                    {current.pixCopyPaste}
                  </code>
                  <CopyButton value={current.pixCopyPaste} />
                </div>
              </div>
            ) : null}
            <div
              className="flex items-center justify-between gap-2 rounded-xl border p-3 text-sm"
              aria-live="polite"
            >
              <span className="flex items-center gap-2">
                <Loader2 className="size-4 animate-spin text-fusai-accent" aria-hidden />
                Aguardando pagamento…
              </span>
              {countdown ? (
                <span className="flex items-center gap-1 text-muted-foreground tabular-nums">
                  <Clock className="size-3.5" aria-hidden /> {countdown.text}
                </span>
              ) : null}
            </div>
            <p className="text-muted-foreground text-xs">
              Abra o app do seu banco, escolha Pix → Ler QR Code ou Pix copia e cola. Esta tela
              atualiza sozinha.
            </p>
          </div>
        ) : null}
      </Dialog>
    </>
  );
}
