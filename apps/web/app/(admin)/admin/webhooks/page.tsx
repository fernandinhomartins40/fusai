import { formatBRL } from '@fusai/shared';
import { Badge } from '@fusai/ui/components/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@fusai/ui/components/table';
import type { Metadata } from 'next';
import { PageHeader } from '@/components/admin/page-header';
import { Pager } from '@/components/admin/pager';
import { ReprocessButton } from '@/components/admin/reprocess-button';
import { FilterFrame } from '@/components/filter-frame';
import type { AdminWebhookEvent, Page } from '@/lib/admin-types';
import { dateTimeBR } from '@/lib/format';
import { serverApi } from '@/lib/session';

export const metadata: Metadata = { title: 'Webhooks recebidos' };

const STATES = [
  { value: '', label: 'Todos' },
  { value: 'pending', label: 'Pendentes' },
  { value: 'error', label: 'Com erro' },
  { value: 'processed', label: 'Processados' },
];
const PROVIDERS = [
  { value: '', label: 'Todos' },
  { value: 'asaas', label: 'Asaas (Pix)' },
  { value: 'velomail', label: 'VeloMail (email)' },
];

type Props = { searchParams: Promise<{ estado?: string; origem?: string; cursor?: string }> };

function State({ e }: { e: AdminWebhookEvent }) {
  if (e.error) return <Badge variant="destructive">erro</Badge>;
  if (!e.processedAt) return <Badge variant="warning">pendente</Badge>;
  return <Badge variant="success">processado</Badge>;
}

export default async function WebhookEventsPage({ searchParams }: Props) {
  const sp = await searchParams;
  const query = new URLSearchParams();
  if (sp.estado) query.set('state', sp.estado);
  if (sp.origem) query.set('provider', sp.origem);
  if (sp.cursor) query.set('cursor', sp.cursor);
  const { data } = await serverApi<Page<AdminWebhookEvent>>(
    `/internal/admin/webhook-events?${query}`,
  );
  const items = data?.items ?? [];

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Webhooks recebidos"
        description="Avisos do Asaas (Pix) e da VeloMail (emails). Pagamentos com erro podem ser reprocessados sem risco de crédito em dobro."
      />
      <FilterFrame
        filters={[
          { name: 'estado', label: 'Situação', options: STATES },
          { name: 'origem', label: 'Origem', options: PROVIDERS },
        ]}
      >
        <div className="grid gap-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Recebido</TableHead>
                <TableHead>Evento</TableHead>
                <TableHead>Pagamento</TableHead>
                <TableHead>Situação</TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-10 text-center text-muted-foreground">
                    Nenhum evento.
                  </TableCell>
                </TableRow>
              ) : (
                items.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className="whitespace-nowrap">{dateTimeBR(e.createdAt)}</TableCell>
                    <TableCell>
                      <code className="font-mono text-xs">{e.type}</code>
                      <span className="block text-muted-foreground text-xs">{e.provider}</span>
                    </TableCell>
                    <TableCell>
                      {e.summary.providerPaymentId ? (
                        <code className="font-mono text-xs">{e.summary.providerPaymentId}</code>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                      {e.summary.valueCents != null ? (
                        <span className="block text-muted-foreground text-xs">
                          {formatBRL(BigInt(e.summary.valueCents) * 10_000n)}
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <State e={e} />
                      {e.error ? (
                        <code className="block font-mono text-destructive text-xs">{e.error}</code>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-right">
                      {e.provider === 'asaas' && (e.error || !e.processedAt) ? (
                        <ReprocessButton eventId={e.id} />
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
          <Pager
            path="/admin/webhooks"
            params={sp}
            cursor={sp.cursor}
            nextCursor={data?.nextCursor}
          />
        </div>
      </FilterFrame>
    </div>
  );
}
