import { formatBRL } from '@fusai/shared';
import { Badge } from '@fusai/ui/components/badge';
import { Button } from '@fusai/ui/components/button';
import { Card, CardContent, CardHeader, CardTitle } from '@fusai/ui/components/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@fusai/ui/components/table';
import { Gift } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { PageHeader } from '@/components/admin/page-header';
import { DailySpendChart } from '@/components/charts/daily-spend-chart';
import { FilterFrame } from '@/components/filter-frame';
import { StatTile } from '@/components/stat-tile';
import type { AdminDashboard } from '@/lib/admin-types';
import { intBR } from '@/lib/format';
import { PERIODS } from '@/lib/periods';
import { serverApi } from '@/lib/session';

export const metadata: Metadata = { title: 'Admin' };

const money = (m: string) =>
  formatBRL(BigInt(m), {
    precise: BigInt(m) !== 0n && BigInt(m) < 10_000n && BigInt(m) > -10_000n,
  });
const cents = (c: number) => formatBRL(BigInt(c) * 10_000n);
const pctLabel = (p: string | null) => (p == null ? '—' : `${p.replace('.', ',')}%`);

type Props = { searchParams: Promise<{ periodo?: string }> };

export default async function AdminHomePage({ searchParams }: Props) {
  const { periodo } = await searchParams;
  const days = PERIODS.some((p) => p.value === periodo) ? Number(periodo) : 30;
  const { data } = await serverApi<AdminDashboard>(`/internal/admin/dashboard?days=${days}`);
  if (!data) throw new Error('Não foi possível carregar o painel');
  const t = data.totals;
  const periodLabel = PERIODS.find((p) => Number(p.value) === days)?.label.toLowerCase() ?? '';
  const netReceived = t.receivedCents - t.refundedCents;
  const negativeMargin = BigInt(t.marginMicros) < 0n;

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Visão geral"
        description="Receita, custo dos provedores e margem, no horário de Brasília."
        actions={
          <Button asChild variant="brand">
            <Link href="/admin/clientes">
              <Gift /> Liberar créditos
            </Link>
          </Button>
        }
      />

      <FilterFrame
        filters={[{ name: 'periodo', label: 'Período', options: PERIODS, defaultValue: '30' }]}
      >
        <div className="grid gap-6">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile
              label="Pix recebido"
              value={cents(netReceived)}
              hint={
                t.refundedCents > 0
                  ? `${t.payments} pagamentos · ${cents(t.refundedCents)} estornados`
                  : `${t.payments} pagamentos · ${periodLabel}`
              }
            />
            <StatTile
              label="Consumo cobrado"
              value={money(t.chargedMicros)}
              hint={`${intBR(t.requests)} requisições`}
            />
            <StatTile
              label="Custo dos provedores"
              value={money(t.costMicros)}
              hint="no câmbio do dia"
            />
            <StatTile
              label="Margem bruta"
              value={
                <span className={negativeMargin ? 'text-destructive' : undefined}>
                  {money(t.marginMicros)}
                </span>
              }
              hint={`${pctLabel(t.marginPct)} do consumo`}
            />
          </div>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile
              label="Saldo em carteiras"
              value={money(
                (
                  BigInt(data.liability.organizationsMicros) + BigInt(data.liability.endUsersMicros)
                ).toString(),
              )}
              hint={`Clientes ${money(data.liability.organizationsMicros)} · usuários finais ${money(data.liability.endUsersMicros)}`}
            />
            <StatTile
              label="Erros de provedor"
              value={intBR(t.errors)}
              hint={
                t.requests
                  ? `${((t.errors / t.requests) * 100).toFixed(1).replace('.', ',')}% das requisições`
                  : 'sem requisições'
              }
            />
            <StatTile
              label="Requisições por minuto"
              value={data.requestsPerMinute.toLocaleString('pt-BR')}
              hint="média dos últimos 5 minutos"
            />
            <StatTile
              label="Clientes"
              value={intBR(data.counts.organizations)}
              hint={`${data.counts.newOrganizations} novos · ${data.counts.suspended} suspensos · ${data.counts.users} usuários`}
            />
          </div>

          <DailySpendChart
            title="Consumo cobrado por dia"
            description={periodLabel}
            data={data.daily.map((d) => ({
              day: d.day,
              requests: d.requests,
              chargedMicros: d.chargedMicros,
              promptTokens: 0,
              completionTokens: 0,
            }))}
          />

          <div className="grid items-start gap-6 xl:grid-cols-2">
            <RankingCard
              title="Top clientes"
              empty="Nenhum consumo no período."
              rows={data.topCustomers.map((c) => ({
                key: c.orgId,
                label: (
                  <Link href={`/admin/clientes/${c.orgId}`} className="hover:underline">
                    {c.name}
                  </Link>
                ),
                ...c,
              }))}
            />
            <RankingCard
              title="Top modelos"
              empty="Nenhum consumo no período."
              rows={data.topModels.map((m) => ({
                key: m.modelId,
                label: (
                  <span className="grid">
                    <span>{m.name}</span>
                    <code className="font-mono text-muted-foreground text-xs">{m.slug}</code>
                  </span>
                ),
                ...m,
              }))}
            />
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Provedores</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Provedor</TableHead>
                    <TableHead className="text-right">Requisições</TableHead>
                    <TableHead className="text-right">Erros</TableHead>
                    <TableHead className="text-right">Latência média</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.providers.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell>
                        <span className="flex items-center gap-2">
                          <Link href={`/admin/provedores/${p.id}`} className="hover:underline">
                            {p.name}
                          </Link>
                          {p.status === 'DISABLED' ? (
                            <Badge variant="secondary">desativado</Badge>
                          ) : null}
                        </span>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{intBR(p.requests)}</TableCell>
                      <TableCell
                        className={`text-right tabular-nums ${p.errors > 0 ? 'text-destructive' : ''}`}
                      >
                        {p.requests
                          ? `${intBR(p.errors)} (${((p.errors / p.requests) * 100).toFixed(1).replace('.', ',')}%)`
                          : '—'}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {p.avgLatencyMs == null
                          ? '—'
                          : p.avgLatencyMs >= 1000
                            ? `${(p.avgLatencyMs / 1000).toFixed(1).replace('.', ',')} s`
                            : `${p.avgLatencyMs} ms`}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      </FilterFrame>
    </div>
  );
}

function RankingCard({
  title,
  empty,
  rows,
}: {
  title: string;
  empty: string;
  rows: {
    key: string;
    label: React.ReactNode;
    requests: number;
    chargedMicros: string;
    costMicros: string;
    marginMicros: string;
    marginPct: string | null;
  }[];
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="py-6 text-center text-muted-foreground text-sm">{empty}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead className="text-right">Cobrado</TableHead>
                <TableHead className="text-right">Custo</TableHead>
                <TableHead className="text-right">Margem</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.key}>
                  <TableCell className="font-medium">
                    {r.label}
                    <span className="block text-muted-foreground text-xs">
                      {intBR(r.requests)} requisições
                    </span>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {money(r.chargedMicros)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{money(r.costMicros)}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {money(r.marginMicros)}
                    <span className="block text-muted-foreground text-xs">
                      {pctLabel(r.marginPct)}
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
