import { describe, expect, it } from 'vitest';
import { csvCell, toCsv } from './csv';
import { spDay, spDaysBetween, spMidnight } from './time';

describe('csv', () => {
  it('quotes separators and quotes', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('diz "oi"')).toBe('"diz ""oi"""');
    expect(csvCell(null)).toBe('');
  });

  it('neutralizes spreadsheet formulas but keeps negative numbers', () => {
    expect(csvCell('=HYPERLINK("http://x")')).toBe('"\'=HYPERLINK(""http://x"")"');
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(csvCell('-1.234567')).toBe('-1.234567');
    expect(csvCell('-cmd')).toBe("'-cmd");
  });

  it('starts with a BOM and uses CRLF', () => {
    expect(toCsv(['a'], [[1]])).toBe('﻿a\r\n1\r\n');
  });
});

describe('São Paulo days', () => {
  it('maps instants to local days', () => {
    expect(spDay(new Date('2026-10-15T02:59:00Z'))).toBe('2026-10-14');
    expect(spDay(new Date('2026-10-15T03:00:00Z'))).toBe('2026-10-15');
    expect(spMidnight('2026-10-15').toISOString()).toBe('2026-10-15T03:00:00.000Z');
  });

  it('lists the days of a range', () => {
    expect(
      spDaysBetween(new Date('2026-10-13T12:00:00Z'), new Date('2026-10-15T12:00:00Z')),
    ).toEqual(['2026-10-13', '2026-10-14', '2026-10-15']);
  });
});
