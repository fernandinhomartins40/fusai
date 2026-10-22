import type { ProviderHealth } from '@/lib/admin-types';
import { intBR } from '@/lib/format';

/** Last 24 h of a provider: requests, error rate, p95 latency and circuit breaker (O-11). */
export function ProviderHealthRow({ health }: { health: ProviderHealth | undefined }) {
  if (!health) return null;
  const errorPct = health.errorPct == null ? null : Number(health.errorPct);
  return (
    <div className="grid gap-1 border-t pt-3 text-xs">
      <p className="text-muted-foreground">Últimas 24 h</p>
      <dl className="grid grid-cols-3 gap-2">
        <div>
          <dt className="text-muted-foreground">Requisições</dt>
          <dd className="mt-0.5 tabular-nums">{intBR(health.requests)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Erros</dt>
          <dd
            className={`mt-0.5 tabular-nums ${errorPct != null && errorPct >= 5 ? 'text-destructive' : ''}`}
          >
            {errorPct == null ? '—' : `${health.errorPct?.replace('.', ',')}%`}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Latência p95</dt>
          <dd className="mt-0.5 tabular-nums">
            {health.p95LatencyMs == null
              ? '—'
              : `${(health.p95LatencyMs / 1000).toFixed(1).replace('.', ',')} s`}
          </dd>
        </div>
      </dl>
      {health.circuitOpen ? (
        <p role="status" className="font-medium text-destructive">
          Circuito aberto: o provedor está sendo pulado por falhas seguidas (volta em até 30 s).
        </p>
      ) : null}
    </div>
  );
}
