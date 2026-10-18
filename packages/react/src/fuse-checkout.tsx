import { type Checkout, type CreditPackage, FusaiError, formatMicros } from '@fusai/sdk';
import { type CSSProperties, useEffect, useId, useRef, useState } from 'react';
import { type FusaiClientProps, useFusaiClient } from './context';
import { s, theme } from './styles';

type Props = FusaiClientProps & {
  /** Package to buy. Without it, the component lists the project's packages to choose from. */
  packageId?: string;
  /** Buyer CPF/CNPJ and name, when your app already has them (otherwise the form asks). */
  document?: string;
  name?: string;
  /** Called once when the Pix is confirmed and the credits are in the end user's wallet. */
  onPaid?: (checkout: Checkout) => void;
  onExpired?: (checkout: Checkout) => void;
  onError?: (error: Error) => void;
  className?: string;
  style?: CSSProperties;
};

type Step =
  | { kind: 'choose' }
  | { kind: 'document' }
  | { kind: 'pending'; checkout: Checkout }
  | { kind: 'done'; checkout: Checkout };

const brlCents = (cents: number) => formatMicros(BigInt(cents) * 10_000n);
const newKey = () =>
  globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;

/**
 * Pix purchase of credits for the signed-in end user (PRD §9.3):
 * package → (CPF, first time) → QR + copy-paste + countdown → live status → success.
 */
export function FusaiCheckout({
  packageId: fixedPackage,
  document: initialDocument,
  name: initialName,
  onPaid,
  onExpired,
  onError,
  className,
  style,
  ...client
}: Props) {
  const fuse = useFusaiClient(client);
  const ids = useId();
  const [packages, setPackages] = useState<CreditPackage[] | null>(null);
  const [selected, setSelected] = useState<string | null>(fixedPackage ?? null);
  const [step, setStep] = useState<Step>({ kind: 'choose' });
  const [document, setDocument] = useState(initialDocument ?? '');
  const [name, setName] = useState(initialName ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const idempotencyKey = useRef(newKey());
  const callbacks = useRef({ onPaid, onExpired, onError });
  callbacks.current = { onPaid, onExpired, onError };

  useEffect(() => {
    if (!fuse) return;
    fuse
      .packages()
      .then((list) => {
        setPackages(list);
        setSelected((cur) => cur ?? list.find((p) => p.highlight)?.id ?? list[0]?.id ?? null);
      })
      .catch((err: Error) => {
        setError(err.message);
        callbacks.current.onError?.(err);
      });
  }, [fuse]);

  // Live status every 3 s while the Pix is open.
  const pendingId = step.kind === 'pending' ? step.checkout.checkoutId : null;
  useEffect(() => {
    if (!fuse || !pendingId) return;
    const controller = new AbortController();
    fuse.checkout
      .waitForPayment(pendingId, {
        signal: controller.signal,
        onUpdate: (c) => {
          if (c.status === 'PENDING') setStep({ kind: 'pending', checkout: c });
        },
      })
      .then((final) => {
        setStep({ kind: 'done', checkout: final });
        if (final.status === 'RECEIVED' || final.status === 'CONFIRMED') {
          callbacks.current.onPaid?.(final);
        } else callbacks.current.onExpired?.(final);
      })
      .catch(() => {}); // aborted on unmount
    return () => controller.abort();
  }, [fuse, pendingId]);

  async function pay() {
    if (!fuse || !selected) return;
    setBusy(true);
    setError(null);
    try {
      const checkout = await fuse.checkout.createPix({
        packageId: selected,
        ...(document.trim() ? { document: document.trim() } : {}),
        ...(name.trim() ? { name: name.trim() } : {}),
        idempotencyKey: idempotencyKey.current,
      });
      setStep({ kind: 'pending', checkout });
    } catch (err) {
      if (err instanceof FusaiError && err.code === 'document_required') {
        // The PSP needs the buyer's CPF/CNPJ: ask for it (only the first time).
        if (step.kind === 'document') setError(err.message);
        setStep({ kind: 'document' });
      } else {
        setError(err instanceof Error ? err.message : 'Não foi possível gerar o Pix.');
        if (err instanceof Error) callbacks.current.onError?.(err);
      }
    } finally {
      setBusy(false);
    }
  }

  function restart() {
    idempotencyKey.current = newKey();
    setStep({ kind: 'choose' });
    setError(null);
  }

  const box = { ...s.box, ...style };
  if (!fuse) {
    return (
      <div className={className} style={box}>
        <p style={s.alert}>FusaiCheckout: informe sessionToken ou use &lt;FusaiProvider&gt;.</p>
      </div>
    );
  }

  return (
    <div className={className} style={box} data-fuse-checkout="">
      {error ? (
        <p role="alert" style={s.alert}>
          {error}
        </p>
      ) : null}

      {step.kind === 'choose' ? (
        <>
          {packages === null ? (
            <p style={s.muted} aria-busy="true">
              Carregando pacotes…
            </p>
          ) : packages.length === 0 ? (
            <p style={s.muted}>Nenhum pacote disponível.</p>
          ) : fixedPackage ? (
            <PackageSummary pkg={packages.find((p) => p.id === fixedPackage)} />
          ) : (
            <fieldset style={{ border: 0, padding: 0, margin: 0, display: 'grid', gap: 8 }}>
              <legend style={{ ...s.title, marginBottom: 8 }}>Escolha um pacote</legend>
              {packages.map((p) => (
                <label
                  key={p.id}
                  style={{
                    ...s.option,
                    borderColor: selected === p.id ? theme.accent : undefined,
                  }}
                >
                  <span style={s.row}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <input
                        type="radio"
                        name={`${ids}-pkg`}
                        value={p.id}
                        checked={selected === p.id}
                        onChange={() => setSelected(p.id)}
                        style={{ accentColor: theme.accent }}
                      />
                      <strong>{p.name}</strong>
                    </span>
                    <strong>{brlCents(p.priceCents)}</strong>
                  </span>
                  <span style={s.muted}>
                    {formatMicros(BigInt(p.creditMicros) + BigInt(p.bonusMicros))} em créditos
                    {p.bonusMicros !== '0'
                      ? ` (inclui ${formatMicros(p.bonusMicros)} de bônus)`
                      : ''}
                  </span>
                </label>
              ))}
            </fieldset>
          )}
          <button type="button" style={s.button} onClick={pay} disabled={busy || !selected}>
            {busy ? 'Gerando Pix…' : 'Pagar com Pix'}
          </button>
        </>
      ) : null}

      {step.kind === 'document' ? (
        <form
          style={{ display: 'grid', gap: 12 }}
          onSubmit={(e) => {
            e.preventDefault();
            void pay();
          }}
        >
          <p style={s.title}>Dados para o Pix</p>
          <p style={s.muted}>O banco exige CPF ou CNPJ de quem paga. Pedimos só uma vez.</p>
          <label htmlFor={`${ids}-doc`} style={{ display: 'grid', gap: 4, fontSize: 14 }}>
            CPF ou CNPJ
            <input
              id={`${ids}-doc`}
              inputMode="numeric"
              autoComplete="off"
              required
              value={document}
              onChange={(e) => setDocument(e.target.value)}
              style={s.input}
            />
          </label>
          <label htmlFor={`${ids}-name`} style={{ display: 'grid', gap: 4, fontSize: 14 }}>
            Nome completo
            <input
              id={`${ids}-name`}
              autoComplete="name"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              style={s.input}
            />
          </label>
          <button type="submit" style={s.button} disabled={busy}>
            {busy ? 'Gerando Pix…' : 'Gerar Pix'}
          </button>
          <button type="button" style={s.secondary} onClick={restart}>
            Voltar
          </button>
        </form>
      ) : null}

      {step.kind === 'pending' ? <PendingPix checkout={step.checkout} /> : null}

      {step.kind === 'done' ? (
        step.checkout.status === 'RECEIVED' || step.checkout.status === 'CONFIRMED' ? (
          <div role="status" style={{ display: 'grid', gap: 8, textAlign: 'center' }}>
            <span aria-hidden style={{ fontSize: 40, color: theme.success }}>
              ✓
            </span>
            <p style={s.title}>Pagamento confirmado!</p>
            <p style={s.muted}>
              {formatMicros(step.checkout.creditMicros)} em créditos já estão disponíveis.
            </p>
            <button type="button" style={s.secondary} onClick={restart}>
              Comprar mais
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

function PackageSummary({ pkg }: { pkg?: CreditPackage }) {
  if (!pkg) return <p style={s.muted}>Pacote indisponível.</p>;
  return (
    <div style={s.row}>
      <span style={{ display: 'grid' }}>
        <strong>{pkg.name}</strong>
        <span style={s.muted}>
          {formatMicros(BigInt(pkg.creditMicros) + BigInt(pkg.bonusMicros))} em créditos
        </span>
      </span>
      <strong style={{ fontSize: 20 }}>{brlCents(pkg.priceCents)}</strong>
    </div>
  );
}

/** QR + copy-paste + countdown of an open Pix (checkout of an end user or organization top-up). */
export function PendingPix({
  checkout: c,
}: {
  checkout: Pick<
    Checkout,
    'amountCents' | 'creditMicros' | 'qrBase64' | 'copyPaste' | 'expiresAt' | 'hostedUrl'
  >;
}) {
  const [now, setNow] = useState(() => Date.now());
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const left = c.expiresAt ? Math.max(0, new Date(c.expiresAt).getTime() - now) : null;
  const countdown =
    left === null
      ? null
      : `${Math.floor(left / 60_000)}:${String(Math.floor((left % 60_000) / 1000)).padStart(2, '0')}`;

  async function copy() {
    if (!c.copyPaste) return;
    try {
      await navigator.clipboard.writeText(c.copyPaste);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* the code stays visible for manual copy */
    }
  }

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div style={s.row}>
        <strong style={{ fontSize: 22 }}>{brlCents(c.amountCents)}</strong>
        <span style={s.muted}>{formatMicros(c.creditMicros)} em créditos</span>
      </div>
      {c.qrBase64 ? (
        <img src={`data:image/png;base64,${c.qrBase64}`} alt="QR Code Pix" style={s.qr} />
      ) : null}
      {c.copyPaste ? (
        <>
          <code style={s.code}>{c.copyPaste}</code>
          <button type="button" style={s.button} onClick={copy}>
            {copied ? 'Código copiado!' : 'Copiar código Pix'}
          </button>
        </>
      ) : null}
      <p style={{ ...s.row, ...s.muted }} aria-live="polite">
        <span>Aguardando pagamento…</span>
        {countdown ? <span>expira em {countdown}</span> : null}
      </p>
      <a
        href={c.hostedUrl}
        target="_blank"
        rel="noopener noreferrer"
        style={{ ...s.muted, textAlign: 'center' }}
      >
        Abrir página de pagamento
      </a>
    </div>
  );
}
