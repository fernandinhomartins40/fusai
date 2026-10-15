'use client';

import { FusaiBalance, FusaiCheckout, FusaiProvider, useFusaiClient } from '@fusai/react';
import type { Model } from '@fusai/sdk';
import { useCallback, useEffect, useState } from 'react';

const BASE_URL = process.env.NEXT_PUBLIC_FUSAI_BASE_URL;

/** Asks OUR backend for a fresh session token (it holds the secret key). */
async function getSessionToken() {
  const res = await fetch('/api/session', { method: 'POST' });
  if (!res.ok) throw new Error('Não foi possível iniciar a sessão');
  return ((await res.json()) as { token: string }).token;
}

export default function Home() {
  const [refreshKey, setRefreshKey] = useState(0);
  const bump = useCallback(() => setRefreshKey((k) => k + 1), []);

  useEffect(() => {
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
  }, []);

  return (
    <FusaiProvider sessionToken={getSessionToken} baseUrl={BASE_URL}>
      <main>
        <header style={{ display: 'grid', gap: 4 }}>
          <h1>Demo: app com créditos de IA via Pix</h1>
          <p className="muted">
            Exemplo mínimo da fusai: o usuário compra créditos com Pix e conversa com a IA. O
            consumo sai da carteira dele.
          </p>
        </header>

        <section className="card" aria-labelledby="saldo">
          <h2 id="saldo">Seu saldo</h2>
          <FusaiBalance className="balance" refreshKey={refreshKey} refreshIntervalMs={15_000} />
        </section>

        <section aria-labelledby="comprar">
          <h2 id="comprar">Comprar créditos</h2>
          <FusaiCheckout onPaid={bump} style={{ maxWidth: 'none' }} />
        </section>

        <Chat onDone={bump} />
        <Webhooks refreshKey={refreshKey} />
      </main>
    </FusaiProvider>
  );
}

function Chat({ onDone }: { onDone: () => void }) {
  const fuse = useFusaiClient();
  const [models, setModels] = useState<Model[]>([]);
  const [model, setModel] = useState('');
  const [prompt, setPrompt] = useState('Explique Pix em uma frase.');
  const [answer, setAnswer] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fuse
      ?.models()
      .then((list) => {
        setModels(list);
        setModel((m) => m || list[0]?.id || '');
      })
      .catch((err: Error) => setError(err.message));
  }, [fuse]);

  async function send(event: React.FormEvent) {
    event.preventDefault();
    if (!fuse || !model) return;
    setBusy(true);
    setError(null);
    setAnswer('');
    try {
      for await (const chunk of fuse.chat.completions.stream({
        model,
        messages: [{ role: 'user', content: prompt }],
      })) {
        setAnswer((a) => a + (chunk.choices[0]?.delta.content ?? ''));
      }
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card" aria-labelledby="chat">
      <h2 id="chat">Conversar com a IA</h2>
      <form onSubmit={send} style={{ display: 'grid', gap: 8 }}>
        <label htmlFor="model" className="muted">
          Modelo
        </label>
        <select
          id="model"
          value={model}
          onChange={(e) => setModel(e.target.value)}
          style={{
            font: 'inherit',
            padding: 10,
            borderRadius: 12,
            background: 'transparent',
            color: 'inherit',
          }}
        >
          {models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
        <label htmlFor="prompt" className="muted">
          Mensagem
        </label>
        <textarea id="prompt" rows={3} value={prompt} onChange={(e) => setPrompt(e.target.value)} />
        <button type="submit" disabled={busy || !model}>
          {busy ? 'Respondendo…' : 'Enviar'}
        </button>
      </form>
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
      {answer ? (
        <p className="answer" aria-live="polite">
          {answer}
        </p>
      ) : null}
    </section>
  );
}

type Received = { id: string; type: string; created: string; data: unknown };

function Webhooks({ refreshKey }: { refreshKey: number }) {
  const [events, setEvents] = useState<Received[]>([]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: refreshKey is an explicit trigger
  useEffect(() => {
    const load = () =>
      fetch('/api/webhooks/fuse')
        .then((r) => r.json())
        .then((d: { events: Received[] }) => setEvents(d.events))
        .catch(() => {});
    void load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [refreshKey]);

  return (
    <section className="card" aria-labelledby="webhooks">
      <h2 id="webhooks">Webhooks recebidos (assinatura verificada)</h2>
      {events.length === 0 ? (
        <p className="muted">Nenhum ainda. Eles chegam quando um Pix é pago.</p>
      ) : (
        events.map((e) => (
          <details key={e.id}>
            <summary>
              <code>{e.type}</code>{' '}
              <span className="muted">{new Date(e.created).toLocaleString('pt-BR')}</span>
            </summary>
            <pre>{JSON.stringify(e.data, null, 2)}</pre>
          </details>
        ))
      )}
    </section>
  );
}
