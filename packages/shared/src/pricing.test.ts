import { describe, expect, it } from 'vitest';
import { compareDecimals, isDecimalString, mulDecimalsCeil, parseDecimal } from './decimal';
import {
  costBrlPerM,
  estimateHoldMicros,
  formatBps,
  type ModelPriceInput,
  marginBps,
  modelPrices,
} from './pricing';

const base: ModelPriceInput = {
  priceMode: 'AUTO',
  inputCostUsdPerM: '0.27',
  cachedInputCostUsdPerM: '0.07',
  outputCostUsdPerM: '0.66',
  markupMultiplier: null,
  inputPriceMicrosPerM: null,
  outputPriceMicrosPerM: null,
};
const ctx = { usdBrlRate: '5.50', defaultMarkup: '4.0' };

describe('decimal', () => {
  it('parses and multiplies exactly', () => {
    expect(parseDecimal('5.50')).toEqual({ digits: 550n, scale: 2 });
    // 0.1 × 0.2 = 0.02 exactly (a float would give 0.020000000000000004)
    expect(mulDecimalsCeil(['0.1', '0.2'], 100n)).toBe(2n);
    expect(mulDecimalsCeil(['1.000001'], 1n)).toBe(2n);
  });

  it('validates and compares', () => {
    expect(isDecimalString('0.12345678')).toBe(true);
    expect(isDecimalString('0.123456789')).toBe(false);
    expect(isDecimalString('-1')).toBe(false);
    expect(isDecimalString('1e-7')).toBe(false);
    expect(compareDecimals('4.0', '4')).toBe(0);
    expect(compareDecimals('0.9', '1')).toBe(-1);
    expect(() => parseDecimal('abc')).toThrow();
  });
});

describe('modelPrices (AUTO)', () => {
  it('matches the PRD example: US$ 0,66 × 5,50 × 4 = R$ 14,52 per 1M', () => {
    expect(modelPrices(base, ctx).outputPerM).toBe(14_520_000n);
  });

  it('computes input and cached input', () => {
    const prices = modelPrices(base, ctx);
    expect(prices.inputPerM).toBe(5_940_000n); // 0.27 × 5.5 × 4
    expect(prices.cachedInputPerM).toBe(1_540_000n); // 0.07 × 5.5 × 4
    expect(prices.markup).toBe('4.0');
  });

  it('cached input falls back to the input price', () => {
    const prices = modelPrices({ ...base, cachedInputCostUsdPerM: null }, ctx);
    expect(prices.cachedInputPerM).toBe(prices.inputPerM);
  });

  it('rounds up to the next micro', () => {
    // 0.12345678 × 5.4321 × 3.333 × 1e6 = 2235208.372268454 -> 2235209
    const prices = modelPrices(
      { ...base, inputCostUsdPerM: '0.12345678', markupMultiplier: '3.333' },
      { usdBrlRate: '5.4321', defaultMarkup: '4' },
    );
    expect(prices.inputPerM).toBe(2_235_209n);
  });

  it('markup precedence: org override > model > default', () => {
    expect(modelPrices({ ...base, markupMultiplier: '2' }, ctx).outputPerM).toBe(7_260_000n);
    expect(
      modelPrices({ ...base, markupMultiplier: '2' }, { ...ctx, orgMarkupOverride: '3' })
        .outputPerM,
    ).toBe(10_890_000n);
  });
});

describe('modelPrices (FIXED)', () => {
  it('uses the fixed prices and ignores costs', () => {
    const prices = modelPrices(
      {
        ...base,
        priceMode: 'FIXED',
        inputPriceMicrosPerM: 3_000_000n,
        outputPriceMicrosPerM: 9_000_000n,
      },
      ctx,
    );
    expect(prices).toMatchObject({
      inputPerM: 3_000_000n,
      cachedInputPerM: 3_000_000n,
      outputPerM: 9_000_000n,
    });
  });

  it('requires both prices', () => {
    expect(() =>
      modelPrices({ ...base, priceMode: 'FIXED', inputPriceMicrosPerM: 1n }, ctx),
    ).toThrow();
  });
});

describe('cost and margin', () => {
  it('converts cost to BRL', () => {
    expect(costBrlPerM('0.66', '5.50')).toBe(3_630_000n);
  });

  it('computes margin in basis points', () => {
    expect(marginBps(14_520_000n, 3_630_000n)).toBe(7500); // 4× markup = 75% margin
    expect(marginBps(1_000_000n, 2_000_000n)).toBe(-10000);
    expect(marginBps(0n, 1n)).toBe(0);
    expect(formatBps(7500)).toBe('75,0%');
  });
});

describe('estimateHoldMicros', () => {
  const prices = { inputPerM: 5_940_000n, outputPerM: 14_520_000n };

  it('uses max_tokens when set', () => {
    // 1000 in × 5.94 + 500 out × 14.52 (per 1M) = 5940 + 7260 micros
    expect(
      estimateHoldMicros({
        promptTokens: 1000,
        maxTokens: 500,
        modelMaxOutputTokens: 8192,
        ...prices,
      }),
    ).toBe(13_200n);
  });

  it('defaults to 4096 output tokens and caps at the model maximum', () => {
    expect(estimateHoldMicros({ promptTokens: 0, modelMaxOutputTokens: 8192, ...prices })).toBe(
      59_474n,
    ); // 4096 × 14.52 = 59473.92 -> 59474
    expect(
      estimateHoldMicros({
        promptTokens: 0,
        maxTokens: 100_000,
        modelMaxOutputTokens: 2000,
        ...prices,
      }),
    ).toBe(29_040n);
  });
});
