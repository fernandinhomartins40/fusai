import { Prisma } from '@fuseai/db';
import { describe, expect, it } from 'vitest';
import { chargeFor, countTokens, estimateUsage, normalizeUsage, providerCost } from './usage';

describe('usage', () => {
  it('normalizes OpenAI and DeepSeek cache fields', () => {
    expect(
      normalizeUsage({
        prompt_tokens: 100,
        completion_tokens: 20,
        prompt_tokens_details: { cached_tokens: 40 },
        completion_tokens_details: { reasoning_tokens: 5 },
      }),
    ).toEqual({ prompt: 100, cached: 40, completion: 20, reasoning: 5 });
    expect(
      normalizeUsage({ prompt_tokens: 100, completion_tokens: 1, prompt_cache_hit_tokens: 70 })
        .cached,
    ).toBe(70);
    expect(
      normalizeUsage({ prompt_tokens: 10, completion_tokens: 1, prompt_cache_hit_tokens: 99 })
        .cached,
    ).toBe(10);
  });

  it('charges cached tokens at the cached price and rounds each part up', () => {
    const prices = {
      inputPerM: 5_940_000n,
      cachedInputPerM: 1_540_000n,
      outputPerM: 14_520_000n,
      markup: '4',
    };
    // 60 × 5.94 + 40 × 1.54 + 20 × 14.52 (per 1M) = 356.4 -> 357, 61.6 -> 62, 290.4 -> 291
    expect(chargeFor({ prompt: 100, cached: 40, completion: 20, reasoning: 0 }, prices)).toBe(710n);
  });

  it('computes provider cost in USD and BRL micros', () => {
    const model = {
      inputCostUsdPerM: new Prisma.Decimal('0.27'),
      cachedInputCostUsdPerM: null,
      outputCostUsdPerM: new Prisma.Decimal('1.10'),
    } as never;
    // 1000 × 0.27 + 500 × 1.10 = 270 + 550 micro-USD; × 5.5 = 1485 + 3025 BRL micros
    expect(
      providerCost({ prompt: 1000, cached: 0, completion: 500, reasoning: 0 }, model, '5.50'),
    ).toEqual({
      costUsdMicros: 820n,
      costBrlMicros: 4510n,
    });
  });

  it('estimates usage with the cl100k tokenizer', () => {
    expect(countTokens('')).toBe(0);
    expect(countTokens('hello world')).toBe(2);
    const usage = estimateUsage([{ role: 'user', content: 'hello world' }], 'hi there');
    expect(usage.completion).toBe(2);
    expect(usage.prompt).toBeGreaterThan(2);
  });
});
