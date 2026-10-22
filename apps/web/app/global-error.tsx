'use client';

// Replaces the root layout when it fails, so it brings its own <html>/<body> and inline styles.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="pt-BR">
      <body
        style={{
          margin: 0,
          minHeight: '100dvh',
          display: 'grid',
          placeItems: 'center',
          background: '#0a0e1a',
          color: '#e8ebf3',
          fontFamily: 'system-ui, sans-serif',
          textAlign: 'center',
          padding: 16,
        }}
      >
        <div style={{ maxWidth: 360, display: 'grid', gap: 12 }}>
          <strong style={{ fontSize: 20 }}>fusai</strong>
          <h1 style={{ fontSize: 22, margin: 0 }}>Algo deu errado</h1>
          <p style={{ margin: 0, opacity: 0.75 }}>
            Não foi possível carregar a página. Tente de novo em alguns segundos.
          </p>
          {error.digest ? (
            <p style={{ margin: 0, fontSize: 12, opacity: 0.6 }}>Código: {error.digest}</p>
          ) : null}
          <button
            type="button"
            onClick={reset}
            style={{
              padding: '10px 16px',
              borderRadius: 12,
              border: 0,
              background: '#0066fe',
              color: '#fff',
              fontSize: 14,
              cursor: 'pointer',
            }}
          >
            Tentar de novo
          </button>
        </div>
      </body>
    </html>
  );
}
