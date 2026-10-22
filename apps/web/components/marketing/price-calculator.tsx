'use client';

import { brlToMicros, costForTokens, formatBRL } from '@fusai/shared/money';
import { Input } from '@fusai/ui/components/input';
import { Label } from '@fusai/ui/components/label';
import { Select } from '@fusai/ui/components/select';
import { useId, useState } from 'react';

type CalcModel = { id: string; name: string; input: string; output: string };

const MAX_TOKENS = 100_000_000_000n;

/** Digits only ("1.000.000" → 1000000n), capped so a pasted giant number cannot break the UI. */
function parseTokens(text: string): bigint {
  const digits = text.replace(/\D/g, '');
  if (!digits) return 0n;
  const value = BigInt(digits.slice(0, 15));
  return value > MAX_TOKENS ? MAX_TOKENS : value;
}

const groupDigits = (n: bigint) => n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');

/** Monthly cost estimate (PRD §11.2): model + tokens per month → R$, same rounding as billing. */
export function PriceCalculator({ models }: { models: CalcModel[] }) {
  const id = useId();
  const [modelId, setModelId] = useState(models[0]?.id ?? '');
  const [input, setInput] = useState('2.000.000');
  const [output, setOutput] = useState('500.000');
  const model = models.find((m) => m.id === modelId) ?? models[0];
  if (!model) return null;

  const inTokens = parseTokens(input);
  const outTokens = parseTokens(output);
  const inCost = costForTokens(inTokens, brlToMicros(model.input));
  const outCost = costForTokens(outTokens, brlToMicros(model.output));
  const total = inCost + outCost;

  return (
    <div className="grid gap-6 rounded-2xl border bg-card p-5 sm:p-6 md:grid-cols-[1.2fr_1fr] md:gap-8">
      <div className="grid gap-4">
        <div className="grid gap-1.5">
          <Label htmlFor={`${id}-model`}>Modelo</Label>
          <Select id={`${id}-model`} value={model.id} onChange={(e) => setModelId(e.target.value)}>
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor={`${id}-in`}>Tokens de entrada por mês</Label>
            <Input
              id={`${id}-in`}
              inputMode="numeric"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onBlur={() => setInput(groupDigits(inTokens))}
              aria-describedby={`${id}-hint`}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor={`${id}-out`}>Tokens de saída por mês</Label>
            <Input
              id={`${id}-out`}
              inputMode="numeric"
              value={output}
              onChange={(e) => setOutput(e.target.value)}
              onBlur={() => setOutput(groupDigits(outTokens))}
              aria-describedby={`${id}-hint`}
            />
          </div>
        </div>
        <p id={`${id}-hint`} className="text-muted-foreground text-xs">
          Entrada é o que você envia (prompt e histórico); saída é o que o modelo responde. O painel
          mostra o consumo real de cada chamada.
        </p>
      </div>
      <div className="flex flex-col justify-center gap-3 rounded-xl bg-muted/50 p-5">
        <p className="text-muted-foreground text-sm">Estimativa por mês</p>
        <output
          htmlFor={`${id}-model ${id}-in ${id}-out`}
          aria-live="polite"
          className="font-semibold text-4xl tabular-nums tracking-tight"
        >
          {formatBRL(total)}
        </output>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
          <dt className="text-muted-foreground">Entrada</dt>
          <dd className="text-right tabular-nums">{formatBRL(inCost)}</dd>
          <dt className="text-muted-foreground">Saída</dt>
          <dd className="text-right tabular-nums">{formatBRL(outCost)}</dd>
        </dl>
        <p className="text-muted-foreground text-xs">
          Preço de tabela por milhão de tokens. Sem mensalidade: você paga só o que usar, com
          créditos pré-pagos.
        </p>
      </div>
    </div>
  );
}
