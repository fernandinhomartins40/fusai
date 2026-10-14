import { describe, expect, it } from 'vitest';
import {
  brlToMicros,
  ceilDiv,
  centsToMicros,
  costForTokens,
  formatBRL,
  microsToBrl,
  microsToCentsCeil,
} from './money';

describe('brlToMicros', () => {
  it('parses dot and comma decimals', () => {
    expect(brlToMicros('12.34')).toBe(12_340_000n);
    expect(brlToMicros('12,34')).toBe(12_340_000n);
    expect(brlToMicros('0')).toBe(0n);
    expect(brlToMicros('-1.5')).toBe(-1_500_000n);
  });

  it('accepts numbers without float drift', () => {
    expect(brlToMicros(5.5)).toBe(5_500_000n);
    expect(brlToMicros(0.1)).toBe(100_000n);
  });

  it('rounds up beyond 6 decimals', () => {
    expect(brlToMicros('0.0000001')).toBe(1n);
    expect(brlToMicros('1.0000000')).toBe(1_000_000n);
  });

  it('rejects invalid input', () => {
    expect(() => brlToMicros('abc')).toThrow();
    expect(() => brlToMicros('1.2.3')).toThrow();
    expect(() => brlToMicros(Number.NaN)).toThrow();
  });
});

describe('microsToBrl', () => {
  it('renders exact decimal strings', () => {
    expect(microsToBrl(12_340_000n)).toBe('12.340000');
    expect(microsToBrl(1n)).toBe('0.000001');
    expect(microsToBrl(-1_500_000n)).toBe('-1.500000');
  });
});

describe('cents', () => {
  it('converts cents to micros', () => {
    expect(centsToMicros(1000)).toBe(10_000_000n);
  });

  it('rounds micros to cents upward', () => {
    expect(microsToCentsCeil(10_000n)).toBe(1n);
    expect(microsToCentsCeil(10_001n)).toBe(2n);
    expect(microsToCentsCeil(0n)).toBe(0n);
  });
});

describe('formatBRL', () => {
  it('formats with thousands separators', () => {
    expect(formatBRL(12_340_000n)).toBe('R$ 12,34');
    expect(formatBRL(1_234_567_890_000n)).toBe('R$ 1.234.567,89');
    expect(formatBRL(0n)).toBe('R$ 0,00');
    expect(formatBRL(-5_000_000n)).toBe('-R$ 5,00');
  });

  it('carries cents rounding into the whole part', () => {
    expect(formatBRL(999_999n)).toBe('R$ 1,00');
  });

  it('shows sub-cent values in precise mode', () => {
    expect(formatBRL(1_234n, { precise: true })).toBe('R$ 0,001234');
    expect(formatBRL(12_340_000n, { precise: true })).toBe('R$ 12,34');
  });
});

describe('costForTokens', () => {
  it('charges exact multiples exactly', () => {
    // R$ 14,52 per 1M tokens -> 1M tokens cost R$ 14,52
    expect(costForTokens(1_000_000, 14_520_000n)).toBe(14_520_000n);
  });

  it('always rounds up to the next micro', () => {
    // 1 token at R$ 14,52/1M = 14.52 micros -> 15
    expect(costForTokens(1, 14_520_000n)).toBe(15n);
    // 3 tokens at 1 micro/1M = 0.000003 micros -> 1
    expect(costForTokens(3, 1n)).toBe(1n);
  });

  it('zero tokens or zero price cost nothing', () => {
    expect(costForTokens(0, 14_520_000n)).toBe(0n);
    expect(costForTokens(1000, 0n)).toBe(0n);
  });

  it('rejects negative inputs', () => {
    expect(() => costForTokens(-1, 1n)).toThrow();
    expect(() => costForTokens(1, -1n)).toThrow();
  });
});

describe('ceilDiv', () => {
  it('rounds up', () => {
    expect(ceilDiv(10n, 3n)).toBe(4n);
    expect(ceilDiv(9n, 3n)).toBe(3n);
    expect(() => ceilDiv(1n, 0n)).toThrow();
  });
});
