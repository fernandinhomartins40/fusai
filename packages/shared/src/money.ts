/**
 * Money utilities. Internal amounts are integer micro-reais (BigInt):
 * 1 BRL = 1_000_000 micros. Pix payments use integer cents. Never use float for money.
 */

export const MICROS_PER_BRL = 1_000_000n;
export const MICROS_PER_CENT = 10_000n;
export const TOKENS_PER_PRICE_UNIT = 1_000_000n;

const DECIMAL_RE = /^(-)?(\d+)(?:[.,](\d+))?$/;

/** Parses a BRL decimal ("12.34", "12,34", 12.34) into micros, rounding up past 6 decimals. */
export function brlToMicros(value: string | number): bigint {
  const text = typeof value === 'number' ? numberToPlainString(value) : value.trim();
  const match = DECIMAL_RE.exec(text);
  if (!match) throw new Error(`Invalid BRL amount: "${text}"`);
  const [, sign, whole = '0', fraction = ''] = match;
  let micros = BigInt(whole) * MICROS_PER_BRL + BigInt(fraction.slice(0, 6).padEnd(6, '0'));
  if (/[1-9]/.test(fraction.slice(6))) micros += 1n;
  return sign ? -micros : micros;
}

/** Converts micros to a plain decimal string with 6 places ("12.340000"). */
export function microsToBrl(micros: bigint): string {
  const negative = micros < 0n;
  const abs = negative ? -micros : micros;
  const whole = abs / MICROS_PER_BRL;
  const fraction = (abs % MICROS_PER_BRL).toString().padStart(6, '0');
  return `${negative ? '-' : ''}${whole}.${fraction}`;
}

export function centsToMicros(cents: number | bigint): bigint {
  return BigInt(cents) * MICROS_PER_CENT;
}

/** Converts micros to cents, rounding up (used when charging). */
export function microsToCentsCeil(micros: bigint): bigint {
  return ceilDiv(micros, MICROS_PER_CENT);
}

/** Formats micros as BRL ("R$ 12,34"). `precise` keeps sub-cent digits ("R$ 0,001234"). */
export function formatBRL(micros: bigint, options: { precise?: boolean } = {}): string {
  const negative = micros < 0n;
  const abs = negative ? -micros : micros;
  let whole = abs / MICROS_PER_BRL;
  const fractionMicros = abs % MICROS_PER_BRL;
  let fraction: string;
  if (options.precise) {
    fraction = fractionMicros.toString().padStart(6, '0').replace(/0+$/, '').padEnd(2, '0');
  } else {
    // Round half up to cents for display only (never used for charging).
    let cents = (fractionMicros + MICROS_PER_CENT / 2n) / MICROS_PER_CENT;
    if (cents === 100n) {
      whole += 1n;
      cents = 0n;
    }
    fraction = cents.toString().padStart(2, '0');
  }
  const wholeText = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${negative ? '-' : ''}R$ ${wholeText},${fraction}`;
}

/** Cost of `tokens` at a price in micros per 1M tokens, always rounded UP to the next micro. */
export function costForTokens(tokens: number | bigint, pricePerMMicros: bigint): bigint {
  const count = BigInt(tokens);
  if (count < 0n) throw new Error('Token count cannot be negative');
  if (pricePerMMicros < 0n) throw new Error('Price cannot be negative');
  return ceilDiv(count * pricePerMMicros, TOKENS_PER_PRICE_UNIT);
}

/** Ceiling division for non-negative dividends and positive divisors. */
export function ceilDiv(a: bigint, b: bigint): bigint {
  if (b <= 0n) throw new Error('Divisor must be positive');
  const q = a / b;
  return a % b > 0n ? q + 1n : q;
}

function numberToPlainString(value: number): string {
  if (!Number.isFinite(value)) throw new Error(`Invalid BRL amount: ${value}`);
  // 7 digits keep a guard digit so values past 6 decimals still round up.
  return value.toFixed(7);
}
