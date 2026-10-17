import { Badge } from '@fusai/ui/components/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@fusai/ui/components/card';
import { CheckCircle2, XCircle } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { PageHeader } from '@/components/admin/page-header';
import { RefreshButton } from '@/components/refresh-button';
import { StatTile } from '@/components/stat-tile';
import type { AdminSystem } from '@/lib/admin-types';
import { dateTimeBR, intBR } from '@/lib/format';
import { serverApi } from '@/lib/session';

export const metadata: Metadata = { title: 'Sistema' };

function uptime(seconds: number) {
  const d = Math.floor(seconds / 86_400);
  const h = Math.floor((seconds % 86_400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}min` : `${m}min`;
}

function Check({ label, check }: { label: string; check: AdminSystem['database'] }) {
  return (
    <li className="flex items-center justify-between gap-3">
      <span className="flex items-center gap-2">
        {check.ok ? (
          <CheckCircle2 className="size-4 text-success" aria-hidden />
        ) : (
          <XCircle className="size-4 text-destructive" aria-hidden />
        )}
        {label}
      </span>
      <span className="text-muted-foreground text-sm tabular-nums">
        {check.ok ? `${check.latencyMs} ms` : 'fora do ar'}
      </span>
    </li>
  );
}

export default async function SystemPage() {
  const { data } = await serverApi<AdminSystem>('/internal/admin/system');
  if (!data) throw new Error('Não foi possível carregar o status');
  const q = data.queue;

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Sistema"
        description={`Situação da API em ${dateTimeBR(data.time)}.`}
        actions={<RefreshButton />}
      />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          label="Versão da API"
          value={<code className="font-mono text-lg">{data.version.slice(0, 7)}</code>}
          hint={`Node ${data.node}`}
        />
        <StatTile
          label="No ar há"
          value={uptime(data.uptimeSeconds)}
          hint="desde o último deploy"
        />
        <StatTile
          label="Reservas de saldo ativas"
          value={intBR(data.activeHolds)}
          hint="requisições em andamento"
        />
        <StatTile
          label="Webhooks pendentes"
          value={intBR(data.pendingInboundWebhooks)}
          hint={
            <Link href="/admin/webhooks?estado=pending" className="hover:underline">
              ver eventos →
            </Link>
          }
        />
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Serviços</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="grid gap-3">
              <Check label="Banco de dados (Postgres)" check={data.database} />
              <Check label="Cache e filas (Redis)" check={data.redis} />
            </ul>
            {data.lastMigration ? (
              <p className="mt-4 text-muted-foreground text-xs">
                Última migração: <code className="font-mono">{data.lastMigration}</code>
              </p>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Fila de tarefas (worker)</CardTitle>
          </CardHeader>
          <CardContent>
            {q ? (
              <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
                {(
                  [
                    ['Aguardando', q.waiting],
                    ['Rodando', q.active],
                    ['Agendadas', q.delayed],
                    ['Concluídas', q.completed],
                    ['Com falha', q.failed],
                  ] as const
                ).map(([label, value]) => (
                  <div key={label} className="grid">
                    <dt className="text-muted-foreground text-xs">{label}</dt>
                    <dd className="font-semibold tabular-nums">{intBR(value)}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="text-destructive text-sm">Não foi possível ler a fila.</p>
            )}
            {data.failedOutboundWebhooks > 0 ? (
              <p className="mt-4 text-sm">
                <Badge variant="warning">{data.failedOutboundWebhooks}</Badge> webhooks para
                clientes falharam após todas as tentativas.
              </p>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
