/** Period presets for usage filters (days, counted in São Paulo time by the API). */
export const PERIODS = [
  { value: '1', label: 'Hoje' },
  { value: '7', label: 'Últimos 7 dias' },
  { value: '30', label: 'Últimos 30 dias' },
  { value: '90', label: 'Últimos 90 dias' },
];

const SP_OFFSET_MS = 3 * 3_600_000; // UTC-3, no DST since 2019

/** [from, to) for a preset: from = 00:00 (São Paulo) of the first day, to = now. */
export function periodRange(value: string | undefined, now = new Date()) {
  const days = PERIODS.some((p) => p.value === value) ? Number(value) : 30;
  const local = new Date(now.getTime() - SP_OFFSET_MS);
  const startOfToday =
    Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) + SP_OFFSET_MS;
  const from = new Date(startOfToday - (days - 1) * 86_400_000);
  return { days, from: from.toISOString(), to: now.toISOString() };
}
