'use client';

import {
  brlToMicros,
  costBrlPerM,
  costForTokens,
  formatBRL,
  isDecimalString,
  marginBps,
  modelPrices,
  mulDecimalsCeil,
  type PriceModeValue,
} from '@fusai/shared';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@fusai/ui/components/card';
import { Input } from '@fusai/ui/components/input';
import { Label } from '@fusai/ui/components/label';
import { useMemo, useState } from 'react';
import type { AdminSettings } from '@/lib/admin-types';
import { pct } from '@/lib/format';

export type PriceDraft = {
  priceMode: PriceModeValue;
  inputCostUsdPerM: string;
  cachedInputCostUsdPerM: string;
  outputCostUsdPerM: string;
  markupMultiplier: string;
  inputPriceBrl: string;
  outputPriceBrl: string;
};

const norm = (v: string) => v.trim().replace(',', '.');
const dec = (v: string, max = 8) => (isDecimalString(norm(v), max) ? norm(v) : null);
const brlOrNull = (v: string) => {
  try {
    return v.trim() ? brlToMicros(v) : null;
  } catch {
    return null;
  }
};

/** Computes prices exactly like the API (shared pricing), for live feedback while editing. */
function compute(draft: PriceDraft, settings: AdminSettings) {
  const inputCost = dec(draft.inputCostUsdPerM);
  const outputCost = dec(draft.outputCostUsdPerM);
  if (!inputCost || !outputCost) return null;
  const markup = draft.markupMultiplier.trim() ? dec(draft.markupMultiplier, 3) : null;
  if (draft.markupMultiplier.trim() && !markup) return null;
  try {
    const prices = modelPrices(
      {
        priceMode: draft.priceMode,
        inputCostUsdPerM: inputCost,
        cachedInputCostUsdPerM: dec(draft.cachedInputCostUsdPerM),
        outputCostUsdPerM: outputCost,
        markupMultiplier: markup,
        inputPriceMicrosPerM: brlOrNull(draft.inputPriceBrl),
        outputPriceMicrosPerM: brlOrNull(draft.outputPriceBrl),
      },
      { usdBrlRate: settings.usd_brl_rate, defaultMarkup: settings.default_markup },
    );
    return {
      ...prices,
      inputCost: costBrlPerM(inputCost, settings.usd_brl_rate),
      outputCost: costBrlPerM(outputCost, settings.usd_brl_rate),
    };
  } catch {
    return null;
  }
}

export function PricePreview({ draft, settings }: { draft: PriceDraft; settings: AdminSettings }) {
  const result = useMemo(() => compute(draft, settings), [draft, settings]);
  const [inM, setInM] = useState('10');
  const [outM, setOutM] = useState('2');

  const sim = useMemo(() => {
    const tin = dec(inM, 3);
    const tout = dec(outM, 3);
    if (!result || !tin || !tout) return null;
    const tokensIn = mulDecimalsCeil([tin], 1_000_000n);
    const tokensOut = mulDecimalsCeil([tout], 1_000_000n);
    const revenue =
      costForTokens(tokensIn, result.inputPerM) + costForTokens(tokensOut, result.outputPerM);
    const cost =
      costForTokens(tokensIn, result.inputCost) + costForTokens(tokensOut, result.outputCost);
    return { revenue, cost, profit: revenue - cost, margin: marginBps(revenue, cost) };
  }, [result, inM, outM]);

  const rows = result
    ? [
        { label: 'Entrada', price: result.inputPerM, cost: result.inputCost },
        { label: 'Entrada (cache)', price: result.cachedInputPerM, cost: null },
        { label: 'Saída', price: result.outputPerM, cost: result.outputCost },
      ]
    : [];

  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Preço final</CardTitle>
          <CardDescription>
            R$ por 1M de tokens · câmbio {settings.usd_brl_rate.replace('.', ',')}
            {result && draft.priceMode === 'AUTO'
              ? ` · margem ${result.markup.replace('.', ',')}×`
              : ''}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {result ? (
            <dl className="grid gap-3">
              {rows.map((r) => (
                <div key={r.label} className="flex items-baseline justify-between gap-3">
                  <dt className="text-muted-foreground text-sm">{r.label}</dt>
                  <dd className="text-right">
                    <span className="font-semibold tabular-nums">{formatBRL(r.price)}</span>
                    {r.cost != null ? (
                      <span className="block text-muted-foreground text-xs tabular-nums">
                        custo {formatBRL(r.cost)} · margem {pct(marginBps(r.price, r.cost))}
                      </span>
                    ) : null}
                  </dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="text-muted-foreground text-sm">
              Preencha os custos (e o preço fixo, se for o caso).
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Simulador de margem</CardTitle>
          <CardDescription>Consumo mensal estimado, em milhões de tokens.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label htmlFor="sim-in">Entrada (M)</Label>
              <Input
                id="sim-in"
                inputMode="decimal"
                value={inM}
                onChange={(e) => setInM(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="sim-out">Saída (M)</Label>
              <Input
                id="sim-out"
                inputMode="decimal"
                value={outM}
                onChange={(e) => setOutM(e.target.value)}
              />
            </div>
          </div>
          {sim ? (
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <dt className="text-muted-foreground">Receita</dt>
                <dd className="font-semibold tabular-nums">{formatBRL(sim.revenue)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Custo</dt>
                <dd className="font-semibold tabular-nums">{formatBRL(sim.cost)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Lucro bruto</dt>
                <dd
                  className={`font-semibold tabular-nums ${sim.profit < 0n ? 'text-destructive' : 'text-success'}`}
                >
                  {formatBRL(sim.profit)}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Margem</dt>
                <dd className="font-semibold tabular-nums">{pct(sim.margin)}</dd>
              </div>
            </dl>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
