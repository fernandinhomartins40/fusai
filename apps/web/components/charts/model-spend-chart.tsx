'use client';

import { formatBRL } from '@fuseai/shared';
import { Bar, BarChart, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { ModelUsage } from '@/lib/dashboard-types';
import { ChartCard } from './chart-card';
import { ChartTooltipBox } from './chart-tooltip';

const MAX_BARS = 7;
const money = (micros: string | bigint) => {
  const m = BigInt(micros);
  return formatBRL(m, { precise: m > 0n && m < 10_000n });
};

type Row = {
  name: string;
  slug: string;
  reais: number;
  chargedMicros: string;
  requests: number;
  tokens: number;
};

/**
 * Spend by model (a ranking = magnitude, not identity): horizontal bars in ONE color,
 * value at the tip. Past 7 models the tail folds into "Outros".
 */
export function ModelSpendChart({
  data,
  description,
}: {
  data: ModelUsage[];
  description?: string;
}) {
  const sorted = [...data].sort((a, b) => {
    const diff = BigInt(b.chargedMicros) - BigInt(a.chargedMicros);
    return diff > 0n ? 1 : diff < 0n ? -1 : a.slug.localeCompare(b.slug);
  });
  const head = sorted.slice(0, MAX_BARS);
  const tail = sorted.slice(MAX_BARS);
  const toRow = (m: ModelUsage): Row => ({
    name: m.name,
    slug: m.slug,
    reais: Number(m.chargedMicros) / 1_000_000,
    chargedMicros: m.chargedMicros,
    requests: m.requests,
    tokens: m.promptTokens + m.completionTokens,
  });
  const rows = head.map(toRow);
  if (tail.length) {
    const charged = tail.reduce((s, m) => s + BigInt(m.chargedMicros), 0n);
    rows.push({
      name: `Outros (${tail.length})`,
      slug: '',
      reais: Number(charged) / 1_000_000,
      chargedMicros: charged.toString(),
      requests: tail.reduce((s, m) => s + m.requests, 0),
      tokens: tail.reduce((s, m) => s + m.promptTokens + m.completionTokens, 0),
    });
  }

  return (
    <ChartCard
      title="Gasto por modelo"
      description={description}
      empty={rows.length === 0}
      emptyText="Nenhum modelo usado no período."
      chart={
        <div className="w-full" style={{ height: Math.max(rows.length * 40 + 16, 120) }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={rows}
              layout="vertical"
              margin={{ top: 0, right: 84, bottom: 0, left: 0 }}
              barCategoryGap={8}
            >
              <XAxis type="number" hide />
              <YAxis
                type="category"
                dataKey="name"
                width={120}
                tick={{ fill: 'var(--muted-foreground)', fontSize: 12 }}
                tickLine={false}
                axisLine={false}
              />
              <Tooltip
                cursor={{ fill: 'var(--accent)', opacity: 0.6 }}
                content={({ active, payload }) => {
                  const row = active ? (payload?.[0]?.payload as Row | undefined) : undefined;
                  if (!row) return null;
                  return (
                    <ChartTooltipBox
                      label={row.slug || row.name}
                      value={money(row.chargedMicros)}
                      sub={`${row.requests.toLocaleString('pt-BR')} requisições · ${row.tokens.toLocaleString('pt-BR')} tokens`}
                    />
                  );
                }}
              />
              <Bar
                dataKey="reais"
                fill="var(--chart-series)"
                isAnimationActive={false}
                maxBarSize={24}
                radius={[0, 4, 4, 0]}
              >
                <LabelList
                  dataKey="chargedMicros"
                  position="right"
                  formatter={(v: unknown) => money(String(v))}
                  style={{ fill: 'var(--foreground)', fontSize: 12 }}
                />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      }
      table={
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-muted-foreground text-xs">
              <th className="py-2 font-medium">Modelo</th>
              <th className="py-2 text-right font-medium">Requisições</th>
              <th className="py-2 text-right font-medium">Tokens</th>
              <th className="py-2 text-right font-medium">Gasto</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((m) => (
              <tr key={m.modelId} className="border-b last:border-0">
                <td className="py-1.5 font-mono text-xs">{m.slug}</td>
                <td className="py-1.5 text-right tabular-nums">
                  {m.requests.toLocaleString('pt-BR')}
                </td>
                <td className="py-1.5 text-right tabular-nums">
                  {(m.promptTokens + m.completionTokens).toLocaleString('pt-BR')}
                </td>
                <td className="py-1.5 text-right tabular-nums">{money(m.chargedMicros)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      }
    />
  );
}
