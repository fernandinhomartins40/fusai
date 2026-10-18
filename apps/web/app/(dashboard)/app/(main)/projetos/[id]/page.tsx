import { formatBRL } from '@fusai/shared';
import type { Metadata } from 'next';
import { DailySpendChart } from '@/components/charts/daily-spend-chart';
import { CodeBlock } from '@/components/copy-button';
import { StatTile } from '@/components/stat-tile';
import { API_URL } from '@/lib/config';
import type { ProjectDetail, UsageReport } from '@/lib/dashboard-types';
import { periodRange } from '@/lib/periods';
import { serverApi } from '@/lib/session';

export const metadata: Metadata = { title: 'Projeto' };

const money = (m: string) =>
  formatBRL(BigInt(m), { precise: BigInt(m) > 0n && BigInt(m) < 10_000n });

export default async function ProjectOverviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { data: project } = await serverApi<ProjectDetail>(`/internal/projects/${id}`);
  if (!project) return null;
  const range = periodRange('30');
  const query = new URLSearchParams({ from: range.from, to: range.to, projectId: project.id });
  const { data: usage } = await serverApi<UsageReport>(
    `/internal/organizations/${project.orgId}/usage?${query}`,
  );
  if (!usage) throw new Error('Não foi possível carregar o consumo do projeto');

  return (
    <div className="grid gap-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile label="Gasto (30 dias)" value={money(usage.totals.chargedMicros)} />
        <StatTile label="Requisições" value={usage.totals.requests.toLocaleString('pt-BR')} />
        <StatTile
          label="Tokens de entrada"
          value={usage.totals.promptTokens.toLocaleString('pt-BR')}
        />
        <StatTile
          label="Tokens de saída"
          value={usage.totals.completionTokens.toLocaleString('pt-BR')}
        />
      </div>
      <DailySpendChart data={usage.daily} description="Últimos 30 dias" />
      <section className="grid gap-3">
        <h2 className="font-semibold text-lg">Chamar a API</h2>
        <CodeBlock
          label="curl"
          code={`curl ${API_URL}/v1/chat/completions \\
  -H "Authorization: Bearer $FUSAI_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"model":"fuse/auto","messages":[{"role":"user","content":"Olá!"}]}'`}
        />
      </section>
    </div>
  );
}
