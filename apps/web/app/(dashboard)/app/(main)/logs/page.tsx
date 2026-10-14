import type { Metadata } from 'next';
import { FilterFrame } from '@/components/filter-frame';
import { LogsTable } from '@/components/logs-table';
import { RefreshButton } from '@/components/refresh-button';
import { getCurrentOrg } from '@/lib/current-org';
import type { LogItem } from '@/lib/dashboard-types';
import { statusLabel } from '@/lib/log-status';
import { getMe, serverApi } from '@/lib/session';

export const metadata: Metadata = { title: 'Logs' };

type Props = { searchParams: Promise<{ projeto?: string; status?: string }> };

export default async function LogsPage({ searchParams }: Props) {
  const org = await getCurrentOrg(await getMe());
  if (!org) return null;
  const sp = await searchParams;
  const query = new URLSearchParams({ limit: '50' });
  if (sp.projeto) query.set('projectId', sp.projeto);
  if (sp.status && sp.status in statusLabel) query.set('status', sp.status);
  const endpoint = `/internal/organizations/${org.id}/logs?${query}`;
  const { data } = await serverApi<{ items: LogItem[]; nextCursor: string | null }>(endpoint);
  if (!data) throw new Error('Não foi possível carregar os logs');

  return (
    <div className="grid gap-6">
      <div className="grid gap-1">
        <h1 className="font-semibold text-2xl tracking-tight">Logs</h1>
        <p className="text-muted-foreground text-sm">
          Últimas requisições ao gateway. O conteúdo das mensagens não é armazenado.
        </p>
      </div>
      <FilterFrame
        filters={[
          {
            name: 'projeto',
            label: 'Projeto',
            options: [
              { value: '', label: 'Todos os projetos' },
              ...org.projects.map((p) => ({ value: p.id, label: p.name })),
            ],
          },
          {
            name: 'status',
            label: 'Status',
            options: [
              { value: '', label: 'Todos' },
              ...Object.entries(statusLabel).map(([value, s]) => ({ value, label: s.label })),
            ],
          },
        ]}
        actions={<RefreshButton />}
      >
        <LogsTable endpoint={endpoint} initial={data} />
      </FilterFrame>
    </div>
  );
}
