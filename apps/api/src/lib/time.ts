import { Prisma } from '@fusai/db';

/** Display time zone (PRD §16). Brazil has had no DST since 2019: a fixed UTC-3 offset. */
export const TZ = 'America/Sao_Paulo';
const OFFSET = '-03:00';
const DAY_MS = 86_400_000;

const ymdFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** "YYYY-MM-DD" of an instant in São Paulo. */
export function spDay(date: Date): string {
  return ymdFormat.format(date);
}

/** UTC instant of 00:00 in São Paulo on the given day. */
export function spMidnight(day: string): Date {
  return new Date(`${day}T00:00:00${OFFSET}`);
}

export function startOfSpDay(date = new Date()): Date {
  return spMidnight(spDay(date));
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

/** Every São Paulo day in [from, to). */
export function spDaysBetween(from: Date, to: Date): string[] {
  const days: string[] = [];
  for (let d = startOfSpDay(from); d < to; d = addDays(d, 1)) days.push(spDay(d));
  return days;
}

/**
 * Prisma stores DateTime as UTC in `timestamp` columns; raw SQL must compare in UTC
 * whatever the session time zone is (see D-035).
 */
export const utc = (date: Date) => Prisma.sql`(${date}::timestamptz AT TIME ZONE 'UTC')`;

/** São Paulo calendar day of a UTC `timestamp` column, as text. */
export const spDayOf = (column: Prisma.Sql) =>
  Prisma.sql`to_char((${column} AT TIME ZONE 'UTC') AT TIME ZONE ${TZ}, 'YYYY-MM-DD')`;
