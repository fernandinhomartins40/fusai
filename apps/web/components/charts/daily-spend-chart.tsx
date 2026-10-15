'use client';

import { formatBRL } from '@fusai/shared';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { DailyPoint } from '@/lib/dashboard-types';
import { ChartCard } from './chart-card';
import { ChartTooltipBox } from './chart-tooltip';

const money = (micros: string | bigint) => {
  const m = BigInt(micros);
  return formatBRL(m, { precise: m > 0n && m < 10_000n });
};

const dayLabel = (day: string) => {
  const [, month, d] = day.split('-');
  return `${d}/${month}`;
};

/**
 * Axis ticks in reais without the currency symbol (the card subtitle names the unit).
 * Plot values only: money is never computed from these floats.
 */
const tick = (reais: number) =>
  reais.toLocaleString('pt-BR', {
    minimumFractionDigits: reais > 0 && reais < 1 ? 2 : 0,
    maximumFractionDigits: reais < 1 ? 3 : 0,
  });

type Row = DailyPoint & { reais: number };

/** Spend per day: one series, one validated color, columns ≤ 24px with 4px rounded tips. */
export function DailySpendChart({
  data,
  title = 'Gasto por dia',
  description,
}: {
  data: DailyPoint[];
  title?: string;
  description?: string;
}) {
  const rows: Row[] = data.map((d) => ({ ...d, reais: Number(d.chargedMicros) / 1_000_000 }));
  const empty = rows.every((r) => r.requests === 0);
  const subtitle = description ? `${description} · valores em reais` : 'Valores em reais';

  return (
    <ChartCard
      title={title}
      description={subtitle}
      empty={empty}
      emptyText="Nenhuma requisição no período."
      chart={
        <div className="h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={rows}
              margin={{ top: 8, right: 4, bottom: 0, left: 0 }}
              barCategoryGap={2}
            >
              <CartesianGrid vertical={false} stroke="var(--chart-grid)" strokeWidth={1} />
              <XAxis
                dataKey="day"
                tickFormatter={dayLabel}
                tick={{ fill: 'var(--chart-axis)', fontSize: 11 }}
                tickLine={false}
                axisLine={{ stroke: 'var(--chart-grid)' }}
                interval="preserveStartEnd"
                minTickGap={16}
              />
              <YAxis
                tickFormatter={tick}
                tick={{ fill: 'var(--chart-axis)', fontSize: 11 }}
                tickLine={false}
                axisLine={false}
                width={48}
                allowDecimals
              />
              <Tooltip
                cursor={{ fill: 'var(--accent)', opacity: 0.6 }}
                content={({ active, payload }) => {
                  const row = active ? (payload?.[0]?.payload as Row | undefined) : undefined;
                  if (!row) return null;
                  return (
                    <ChartTooltipBox
                      label={dayLabel(row.day)}
                      value={money(row.chargedMicros)}
                      sub={`${row.requests.toLocaleString('pt-BR')} requisições`}
                    />
                  );
                }}
              />
              <Bar
                dataKey="reais"
                fill="var(--chart-series)"
                isAnimationActive={false}
                maxBarSize={24}
                radius={[4, 4, 0, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      }
      table={
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-muted-foreground text-xs">
              <th className="py-2 font-medium">Dia</th>
              <th className="py-2 text-right font-medium">Requisições</th>
              <th className="py-2 text-right font-medium">Gasto</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.day} className="border-b last:border-0">
                <td className="py-1.5 tabular-nums">{dayLabel(r.day)}</td>
                <td className="py-1.5 text-right tabular-nums">
                  {r.requests.toLocaleString('pt-BR')}
                </td>
                <td className="py-1.5 text-right tabular-nums">{money(r.chargedMicros)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      }
    />
  );
}
