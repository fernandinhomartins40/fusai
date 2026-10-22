import { formatBRL } from '@fusai/shared';
import { Button } from '@fusai/ui/components/button';
import { AlertTriangle, Plus } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { DailySpendChart } from '@/components/charts/daily-spend-chart';
import { ModelSpendChart } from '@/components/charts/model-spend-chart';
import { ActivationChecklist } from '@/components/onboarding/activation-checklist';
import { StatTile } from '@/components/stat-tile';
import { getCurrentOrg } from '@/lib/current-org';
import type { Overview } from '@/lib/dashboard-types';
import { getMe, serverApi } from '@/lib/session';

export const metadata: Metadata = { title: 'Visão geral' };

const money = (m: string) =>
  formatBRL(BigInt(m), { precise: BigInt(m) > 0n && BigInt(m) < 10_000n });
const count = (n: number) => n.toLocaleString('pt-BR');

export default async function OverviewPage() {
  const me = await getMe();
  const org = await getCurrentOrg(me);
  if (!me || !org) return null;
  const { data: o } = await serverApi<Overview>(`/internal/organizations/${org.id}/overview`);
  if (!o) throw new Error('Não foi possível carregar a visão geral');

  const available = BigInt(o.wallet.availableMicros);

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="grid gap-1">
          <p className="text-muted-foreground text-sm">{org.name}</p>
          <h1 className="font-semibold text-2xl tracking-tight">
            Olá, {me.user.name.split(' ')[0]}!
          </h1>
        </div>
        {o.billingType !== 'INTERNAL' ? (
          <Button asChild variant="brand">
            <Link href="/app/carteira?recarga=1">
              <Plus /> Adicionar créditos
            </Link>
          </Button>
        ) : null}
      </div>

      {o.lowBalance.isLow ? (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-3 rounded-2xl border border-warning/40 bg-warning/10 p-4 text-sm"
        >
          <AlertTriangle className="size-5 shrink-0 text-warning-foreground" aria-hidden />
          <p className="min-w-0 flex-1">
            <strong>Saldo baixo:</strong> {formatBRL(available)} disponíveis (alerta abaixo de{' '}
            {formatBRL(BigInt(o.lowBalance.thresholdMicros))}). Quando acabar, seus apps param de
            receber respostas da IA até você recarregar.
          </p>
          <Button asChild size="sm" variant="outline">
            <Link href="/app/carteira?recarga=1">Recarregar</Link>
          </Button>
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile
          className="col-span-2 lg:col-span-1"
          hero
          label="Disponível"
          value={o.billingType === 'INTERNAL' ? 'Sem cobrança' : formatBRL(available)}
          hint={
            o.billingType === 'INTERNAL'
              ? 'Organização interna'
              : `${formatBRL(BigInt(o.wallet.reservedMicros))} reservados`
          }
        />
        <StatTile
          label="Gasto hoje"
          value={money(o.spend.today)}
          hint={`${count(o.requests.today)} requisições`}
        />
        <StatTile
          label="Últimos 7 dias"
          value={money(o.spend.last7d)}
          hint={`${count(o.requests.last7d)} requisições`}
        />
        <StatTile
          className="col-span-2 sm:col-span-1"
          label="Últimos 30 dias"
          value={money(o.spend.last30d)}
          hint={`${count(o.requests.last30d)} requisições`}
        />
      </div>

      <ActivationChecklist activation={o.activation} />

      <div className="grid gap-4 xl:grid-cols-2">
        <DailySpendChart data={o.daily} description="Últimos 30 dias, horário de Brasília" />
        <ModelSpendChart data={o.byModel} description="Últimos 30 dias" />
      </div>
    </div>
  );
}
