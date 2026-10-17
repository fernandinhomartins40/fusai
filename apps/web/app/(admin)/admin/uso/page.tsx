import { formatBRL } from '@fusai/shared';
import { Badge } from '@fusai/ui/components/badge';
import { Button } from '@fusai/ui/components/button';
import { Input } from '@fusai/ui/components/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@fusai/ui/components/table';
import { Search } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { PageHeader } from '@/components/admin/page-header';
import { Pager } from '@/components/admin/pager';
import { FilterFrame } from '@/components/filter-frame';
import type { AdminModel, AdminProvider, AdminUsageRow, Page } from '@/lib/admin-types';
import type { LogItem } from '@/lib/dashboard-types';
import { dateTimeBR, intBR } from '@/lib/format';
import { statusLabel } from '@/lib/log-status';
import { PERIODS, periodRange } from '@/lib/periods';
import { serverApi } from '@/lib/session';

export const metadata: Metadata = { title: 'Uso' };

const money = (m: string) => {
  const v = BigInt(m);
  return formatBRL(v, { precise: v !== 0n && v < 10_000n && v > -10_000n });
};

type Props = {
  searchParams: Promise<{
    periodo?: string;
    cliente?: string;
    modelo?: string;
    provedor?: string;
    status?: string;
    req?: string;
    cursor?: string;
  }>;
};

export default async function AdminUsagePage({ searchParams }: Props) {
  const sp = await searchParams;
  const range = periodRange(sp.periodo ?? '7');
  const query = new URLSearchParams({ from: range.from, to: range.to });
  if (sp.cliente) query.set('orgId', sp.cliente);
  if (sp.modelo) query.set('modelId', sp.modelo);
  if (sp.provedor) query.set('providerId', sp.provedor);
  if (sp.status) query.set('status', sp.status);
  if (sp.req) query.set('requestId', sp.req);
  if (sp.cursor) query.set('cursor', sp.cursor);

  const [{ data }, { data: orgs }, { data: models }, { data: providers }] = await Promise.all([
    serverApi<Page<AdminUsageRow>>(`/internal/admin/usage?${query}`),
    serverApi<Page<{ id: string; name: string }>>('/internal/admin/organizations?limit=100'),
    serverApi<{ models: AdminModel[] }>('/internal/admin/models'),
    serverApi<{ providers: AdminProvider[] }>('/internal/admin/providers'),
  ]);
  const items = data?.items ?? [];
  const orgOptions = orgs?.items ?? [];
  // A customer opened from its page may be beyond the first 100: keep it selectable.
  if (sp.cliente && !orgOptions.some((o) => o.id === sp.cliente)) {
    orgOptions.unshift({ id: sp.cliente, name: items[0]?.org.name ?? 'Cliente selecionado' });
  }

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Uso"
        description="Cada requisição de todos os clientes, com custo do provedor, valor cobrado e margem."
      />

      <form className="flex gap-2">
        <label htmlFor="req" className="sr-only">
          ID da requisição
        </label>
        <Input
          id="req"
          name="req"
          defaultValue={sp.req}
          placeholder="ID da requisição (x-fuse-request-id)"
          className="max-w-md font-mono"
        />
        <Button type="submit" variant="outline">
          <Search /> Buscar
        </Button>
      </form>

      <FilterFrame
        filters={[
          { name: 'periodo', label: 'Período', options: PERIODS, defaultValue: '7' },
          {
            name: 'cliente',
            label: 'Cliente',
            options: [
              { value: '', label: 'Todos os clientes' },
              ...orgOptions.map((o) => ({ value: o.id, label: o.name })),
            ],
          },
          {
            name: 'provedor',
            label: 'Provedor',
            options: [
              { value: '', label: 'Todos' },
              ...(providers?.providers ?? []).map((p) => ({ value: p.id, label: p.name })),
            ],
          },
          {
            name: 'modelo',
            label: 'Modelo',
            options: [
              { value: '', label: 'Todos' },
              ...(models?.models ?? []).map((m) => ({ value: m.id, label: m.slug })),
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
      >
        <div className="grid gap-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Quando</TableHead>
                <TableHead>Cliente</TableHead>
                <TableHead>Modelo</TableHead>
                <TableHead className="text-right">Tokens</TableHead>
                <TableHead className="text-right">Custo</TableHead>
                <TableHead className="text-right">Cobrado</TableHead>
                <TableHead className="text-right">Margem</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="py-10 text-center text-muted-foreground">
                    Nenhuma requisição com esses filtros.
                  </TableCell>
                </TableRow>
              ) : (
                items.map((r) => {
                  const status = statusLabel[r.status as LogItem['status']];
                  const margin = (BigInt(r.chargedMicros) - BigInt(r.costMicros)).toString();
                  return (
                    <TableRow key={r.id}>
                      <TableCell className="whitespace-nowrap">
                        {dateTimeBR(r.createdAt)}
                        <code className="block font-mono text-muted-foreground text-xs">
                          {r.requestId.slice(0, 13)}
                        </code>
                      </TableCell>
                      <TableCell>
                        <Link href={`/admin/clientes/${r.org.id}`} className="hover:underline">
                          {r.org.name}
                        </Link>
                        {r.endUser ? (
                          <span className="block text-muted-foreground text-xs">usuário final</span>
                        ) : null}
                      </TableCell>
                      <TableCell>
                        <code className="font-mono text-xs">{r.model}</code>
                        <span className="block text-muted-foreground text-xs">{r.provider}</span>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {intBR(r.promptTokens + r.completionTokens)}
                        <span className="block text-muted-foreground text-xs">
                          {intBR(r.promptTokens)} → {intBR(r.completionTokens)}
                        </span>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {money(r.costMicros)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {money(r.chargedMicros)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{money(margin)}</TableCell>
                      <TableCell>
                        <Badge variant={status?.variant ?? 'secondary'}>
                          {status?.label ?? r.status}
                        </Badge>
                        {r.errorCode ? (
                          <code className="block font-mono text-muted-foreground text-xs">
                            {r.errorCode}
                          </code>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
          <Pager path="/admin/uso" params={sp} cursor={sp.cursor} nextCursor={data?.nextCursor} />
        </div>
      </FilterFrame>
    </div>
  );
}
