import { formatBRL } from '@fuseai/shared';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@fuseai/ui/components/table';
import type { Metadata } from 'next';
import { DailySpendChart } from '@/components/charts/daily-spend-chart';
import { ModelSpendChart } from '@/components/charts/model-spend-chart';
import { ExportCsvButton } from '@/components/export-csv-button';
import { FilterFrame } from '@/components/filter-frame';
import { StatTile } from '@/components/stat-tile';
import { getCurrentOrg } from '@/lib/current-org';
import type { OrgModel, UsageReport } from '@/lib/dashboard-types';
import { PERIODS, periodRange } from '@/lib/periods';
import { getMe, serverApi } from '@/lib/session';

export const metadata: Metadata = { title: 'Consumo' };

const money = (m: string) =>
  formatBRL(BigInt(m), { precise: BigInt(m) > 0n && BigInt(m) < 10_000n });

type Props = { searchParams: Promise<{ periodo?: string; projeto?: string; modelo?: string }> };

export default async function UsagePage({ searchParams }: Props) {
  const org = await getCurrentOrg(await getMe());
  if (!org) return null;
  const sp = await searchParams;
  const range = periodRange(sp.periodo);
  const query = new URLSearchParams({ from: range.from, to: range.to });
  if (sp.projeto) query.set('projectId', sp.projeto);
  if (sp.modelo) query.set('modelId', sp.modelo);

  const [{ data: report }, { data: models }] = await Promise.all([
    serverApi<UsageReport>(`/internal/organizations/${org.id}/usage?${query}`),
    serverApi<{ models: OrgModel[] }>(`/internal/organizations/${org.id}/models`),
  ]);
  if (!report) throw new Error('Não foi possível carregar o consumo');

  // Models already used in the period stay selectable even if they were deactivated since.
  const modelOptions = new Map((models?.models ?? []).map((m) => [m.id, m.slug]));
  for (const m of report.byModel)
    if (!modelOptions.has(m.modelId)) modelOptions.set(m.modelId, m.slug);
  const periodLabel =
    PERIODS.find((p) => Number(p.value) === range.days)?.label.toLowerCase() ?? '';

  return (
    <div className="grid gap-6">
      <div className="grid gap-1">
        <h1 className="font-semibold text-2xl tracking-tight">Consumo</h1>
        <p className="text-muted-foreground text-sm">
          Gasto e requisições de {org.name}, no horário de Brasília.
        </p>
      </div>

      <FilterFrame
        filters={[
          { name: 'periodo', label: 'Período', options: PERIODS, defaultValue: '30' },
          {
            name: 'projeto',
            label: 'Projeto',
            options: [
              { value: '', label: 'Todos os projetos' },
              ...org.projects.map((p) => ({ value: p.id, label: p.name })),
            ],
          },
          {
            name: 'modelo',
            label: 'Modelo',
            options: [
              { value: '', label: 'Todos os modelos' },
              ...[...modelOptions].map(([value, label]) => ({ value, label })),
            ],
          },
        ]}
        actions={<ExportCsvButton path={`/internal/organizations/${org.id}/usage.csv?${query}`} />}
      >
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatTile label="Gasto" value={money(report.totals.chargedMicros)} hint={periodLabel} />
          <StatTile label="Requisições" value={report.totals.requests.toLocaleString('pt-BR')} />
          <StatTile
            label="Tokens de entrada"
            value={report.totals.promptTokens.toLocaleString('pt-BR')}
          />
          <StatTile
            label="Tokens de saída"
            value={report.totals.completionTokens.toLocaleString('pt-BR')}
          />
        </div>

        <div className="grid gap-4 xl:grid-cols-2">
          <DailySpendChart data={report.daily} />
          <ModelSpendChart data={report.byModel} />
        </div>

        <section className="grid gap-3">
          <h2 className="font-semibold text-lg">Por projeto</h2>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Projeto</TableHead>
                <TableHead className="text-right">Requisições</TableHead>
                <TableHead className="text-right">Tokens</TableHead>
                <TableHead className="text-right">Gasto</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {report.byProject.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="py-8 text-center text-muted-foreground">
                    Sem consumo no período.
                  </TableCell>
                </TableRow>
              ) : (
                report.byProject.map((p) => (
                  <TableRow key={p.projectId}>
                    <TableCell className="font-medium">{p.name}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {p.requests.toLocaleString('pt-BR')}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {(p.promptTokens + p.completionTokens).toLocaleString('pt-BR')}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {money(p.chargedMicros)}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </section>
      </FilterFrame>
    </div>
  );
}
