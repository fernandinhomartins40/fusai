/**
 * Exact decimal arithmetic on strings via BigInt (no floats).
 * Used for prices: USD costs (8 decimals), exchange rate and markup multipliers.
 */

const DECIMAL_RE = /^(\d+)(?:\.(\d+))?$/;

export type ScaledDecimal = { digits: bigint; scale: number };

/** Parses a non-negative plain decimal string ("0.66", "5.50", "4"). */
export function parseDecimal(value: string): ScaledDecimal {
  const match = DECIMAL_RE.exec(value.trim());
  if (!match) throw new Error(`Invalid decimal: "${value}"`);
  const [, whole = '0', fraction = ''] = match;
  return { digits: BigInt(whole + fraction), scale: fraction.length };
}

export function isDecimalString(value: string, maxDecimals = 8): boolean {
  const match = DECIMAL_RE.exec(value.trim());
  return !!match && (match[2]?.length ?? 0) <= maxDecimals;
}

/** ceil(product of factors × multiplier), e.g. multiplier 1_000_000n to get micros. */
export function mulDecimalsCeil(factors: string[], multiplier = 1n): bigint {
  let digits = multiplier;
  let scale = 0;
  for (const factor of factors) {
    const parsed = parseDecimal(factor);
    digits *= parsed.digits;
    scale += parsed.scale;
  }
  const divisor = 10n ** BigInt(scale);
  const q = digits / divisor;
  return digits % divisor > 0n ? q + 1n : q;
}

/** Compares two non-negative decimal strings: -1, 0 or 1. */
export function compareDecimals(a: string, b: string): -1 | 0 | 1 {
  const pa = parseDecimal(a);
  const pb = parseDecimal(b);
  const scale = Math.max(pa.scale, pb.scale);
  const na = pa.digits * 10n ** BigInt(scale - pa.scale);
  const nb = pb.digits * 10n ** BigInt(scale - pb.scale);
  return na === nb ? 0 : na < nb ? -1 : 1;
}
