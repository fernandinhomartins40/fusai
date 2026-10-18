import { formatMicros, type Topup, type TopupOptions } from '@fusai/sdk';
import { type CSSProperties, useCallback, useEffect, useId, useRef, useState } from 'react';
import { PendingPix } from './fuse-checkout';
import { s, theme } from './styles';

type Props = {
  /**
   * Base path of YOUR server routes made with `fusaiAccountHandler` from `@fusai/sdk/server`
   * (default `/api/fusai`). The secret key stays on your server.
   */
  endpoint?: string;
  /** Suggested amounts in cents (default R$ 20, 50 e 100). */
  amounts?: number[];
  /** Show the organization balance on top (default true). */
  showBalance?: boolean;
  /** Called once when the Pix is confirmed and the credits are in your wallet. */
  onPaid?: (topup: Topup) => void;
  onError?: (error: Error) => void;
  /** Extra headers for your routes (e.g. CSRF token). Cookies are sent automatically. */
  headers?: Record<string, string>;
  className?: string;
  style?: CSSProperties;
};

type Step = { kind: 'choose' } | { kind: 'pending'; topup: Topup } | { kind: 'done'; topup: Topup };

const brlCents = (cents: number) => formatMicros(BigInt(cents) * 10_000n);
const newKey = () =>
  globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
/** "50,00" / "50.00" / "50" → cents; null when invalid. */
function parseCents(text: string): number | null {
  const m = text
    .trim()
    .replace(/^R\$\s*/i, '')
    .match(/^(\d{1,7})(?:[.,](\d{1,2}))?$/);
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0'));
}

/**
 * Credits for YOUR organization from inside your app ("uso próprio"): balance → amount or
 * package → Pix (QR + copy-paste) → live status → success. Talks only to your server routes.
 */
export function FusaiTopup({
  endpoint = '/api/fusai',
  amounts = [2000, 5000, 10000],
  showBalance = true,
  onPaid,
  onError,
  headers,
  className,
  style,
}: Props) {
  const base = endpoint.replace(/\/+$/, '');
  const ids = useId();
  const [options, setOptions] = useState<TopupOptions | null>(null);
  const [balance, setBalance] = useState<string | null>(null);
  const [choice, setChoice] = useState<string>(`amount:${amounts[1] ?? amounts[0] ?? 5000}`);
  const [custom, setCustom] = useState('');
  const [step, setStep] = useState<Step>({ kind: 'choose' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const idempotencyKey = useRef(newKey());
  const callbacks = useRef({ onPaid, onError });
  callbacks.current = { onPaid, onError };
  const extraHeaders = useRef(headers);
  extraHeaders.current = headers;

  const call = useCallback(
    async <T,>(path: string, init: RequestInit = {}): Promise<T> => {
      const res = await fetch(`${base}${path}`, {
        ...init,
        credentials: 'same-origin',
        headers: {
          ...(init.body ? { 'content-type': 'application/json' } : {}),
          ...extraHeaders.current,
          ...(init.headers as Record<string, string> | undefined),
        },
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error?.message ?? `Erro ${res.status}`);
      return data as T;
    },
    [base],
  );

  const loadBalance = useCallback(() => {
    if (!showBalance) return;
    call<{ available_micros: string }>('/balance')
      .then((b) => setBalance(b.available_micros))
      .catch(() => {});
  }, [call, showBalance]);

  useEffect(() => {
    call<TopupOptions>('/topup-options')
      .then(setOptions)
      .catch((err: Error) => {
        setError(err.message);
        callbacks.current.onError?.(err);
      });
    loadBalance();
  }, [call, loadBalance]);

  // Live status every 3 s while the Pix is open.
  const pendingId = step.kind === 'pending' ? step.topup.checkoutId : null;
  useEffect(() => {
    if (!pendingId) return;
    let stop = false;
    const tick = async () => {
      while (!stop) {
        await new Promise((r) => setTimeout(r, 3000));
        if (stop) return;
        const t = await call<Topup>(`/topups/${encodeURIComponent(pendingId)}`).catch(() => null);
        if (!t || t.status === 'PENDING') continue;
        setStep({ kind: 'done', topup: t });
        if (t.status === 'RECEIVED' || t.status === 'CONFIRMED') {
          callbacks.current.onPaid?.(t);
          loadBalance();
        }
        return;
      }
    };
    void tick();
    return () => {
      stop = true;
    };
  }, [call, pendingId, loadBalance]);

  async function pay() {
    if (!options) return;
    setError(null);
    let body: { amountCents: number } | { packageId: string };
    if (choice.startsWith('package:')) body = { packageId: choice.slice(8) };
    else {
      const cents = choice === 'custom' ? parseCents(custom) : Number(choice.slice(7));
      if (!cents) return setError('Informe um valor válido, ex.: 50,00.');
      if (cents < options.minAmountCents)
        return setError(`O mínimo é ${brlCents(options.minAmountCents)}.`);
      if (cents > options.maxAmountCents)
        return setError(`O máximo é ${brlCents(options.maxAmountCents)}.`);
      body = { amountCents: cents };
    }
    setBusy(true);
    try {
      const topup = await call<Topup>('/topups', {
        method: 'POST',
        body: JSON.stringify(body),
        headers: { 'idempotency-key': idempotencyKey.current },
      });
      setStep({ kind: 'pending', topup });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível gerar o Pix.');
      if (err instanceof Error) callbacks.current.onError?.(err);
    } finally {
      setBusy(false);
    }
  }

  function restart() {
    idempotencyKey.current = newKey();
    setStep({ kind: 'choose' });
    setError(null);
  }

  const radio = (value: string, label: string, detail?: string) => (
    <label
      key={value}
      style={{ ...s.option, borderColor: choice === value ? theme.accent : undefined }}
    >
      <span style={s.row}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            type="radio"
            name={`${ids}-amount`}
            value={value}
            checked={choice === value}
            onChange={() => setChoice(value)}
            style={{ accentColor: theme.accent }}
          />
          <strong>{label}</strong>
        </span>
        {detail ? <span style={s.muted}>{detail}</span> : null}
      </span>
    </label>
  );

  return (
    <div className={className} style={{ ...s.box, ...style }} data-fuse-topup="">
      {showBalance ? (
        <div style={s.row}>
          <span style={s.muted}>Saldo disponível</span>
          <strong style={{ fontSize: 20 }} aria-live="polite">
            {balance === null ? '…' : formatMicros(balance)}
          </strong>
        </div>
      ) : null}

      {error ? (
        <p role="alert" style={s.alert}>
          {error}
        </p>
      ) : null}

      {step.kind === 'choose' ? (
        options === null ? (
          <p style={s.muted} aria-busy="true">
            Carregando…
          </p>
        ) : !options.available ? (
          <p style={s.muted}>
            {options.hasDocument
              ? 'Recarga indisponível para esta conta.'
              : 'Cadastre o CPF ou CNPJ da organização no painel da fusai (Configurações) para recarregar.'}
          </p>
        ) : (
          <>
            <fieldset style={{ border: 0, padding: 0, margin: 0, display: 'grid', gap: 8 }}>
              <legend style={{ ...s.title, marginBottom: 8 }}>Adicionar créditos</legend>
              {options.packages.map((p) =>
                radio(
                  `package:${p.id}`,
                  `${p.name} · ${brlCents(p.priceCents)}`,
                  p.bonusMicros !== '0' ? `+ ${formatMicros(p.bonusMicros)} de bônus` : undefined,
                ),
              )}
              {amounts
                .filter((c) => c >= options.minAmountCents)
                .map((c) => radio(`amount:${c}`, brlCents(c)))}
              {radio('custom', 'Outro valor')}
              {choice === 'custom' ? (
                <label htmlFor={`${ids}-custom`} style={{ display: 'grid', gap: 4, fontSize: 14 }}>
                  Valor em reais (mínimo {brlCents(options.minAmountCents)})
                  <input
                    id={`${ids}-custom`}
                    inputMode="decimal"
                    placeholder="50,00"
                    value={custom}
                    onChange={(e) => setCustom(e.target.value)}
                    style={s.input}
                  />
                </label>
              ) : null}
            </fieldset>
            <button type="button" style={s.button} onClick={pay} disabled={busy}>
              {busy ? 'Gerando Pix…' : 'Pagar com Pix'}
            </button>
          </>
        )
      ) : null}

      {step.kind === 'pending' ? <PendingPix checkout={step.topup} /> : null}

      {step.kind === 'done' ? (
        step.topup.status === 'RECEIVED' || step.topup.status === 'CONFIRMED' ? (
          <div role="status" style={{ display: 'grid', gap: 8, textAlign: 'center' }}>
            <span aria-hidden style={{ fontSize: 40, color: theme.success }}>
              ✓
            </span>
            <p style={s.title}>Pagamento confirmado!</p>
            <p style={s.muted}>
              {formatMicros(step.topup.creditMicros)} em créditos já estão disponíveis.
            </p>
            <button type="button" style={s.secondary} onClick={restart}>
              Adicionar mais
            </button>
          </div>
        ) : (
          <div role="status" style={{ display: 'grid', gap: 8 }}>
            <p style={s.title}>Este Pix expirou.</p>
            <button type="button" style={s.button} onClick={restart}>
              Gerar outro Pix
            </button>
          </div>
        )
      ) : null}
    </div>
  );
}
