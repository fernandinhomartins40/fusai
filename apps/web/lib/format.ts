import { formatBps, formatBRL } from '@fuseai/shared';

/** "14520000" (micros) -> "R$ 14,52". */
export const brl = (micros: string | bigint) => formatBRL(BigInt(micros));

/** Micros -> editable BRL text ("14,52"), keeping sub-cent digits when present. */
export function microsToInput(micros: string | bigint | null): string {
  if (micros == null) return '';
  const value = BigInt(micros);
  const whole = value / 1_000_000n;
  const fraction = (value % 1_000_000n)
    .toString()
    .padStart(6, '0')
    .replace(/0+$/, '')
    .padEnd(2, '0');
  return `${whole},${fraction}`;
}

export const pct = (bps: number) => formatBps(bps);

export const intBR = (n: number) => n.toLocaleString('pt-BR');
