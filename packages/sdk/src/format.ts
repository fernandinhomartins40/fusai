/** Micro-reais (string or bigint) -> "R$ 1.234,56" (rounded down to the cent, for display). */
export function formatMicros(micros: string | bigint): string {
  let value = BigInt(micros);
  const negative = value < 0n;
  if (negative) value = -value;
  const cents = value / 10_000n;
  const whole = (cents / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const fraction = (cents % 100n).toString().padStart(2, '0');
  return `${negative ? '-' : ''}R$ ${whole},${fraction}`;
}
