/**
 * Effective model prices (PRD §7.5), in BRL micros per 1M tokens, always rounded UP:
 *   AUTO:  ceil(costUsdPerM × usdBrlRate × markup × 1_000_000)
 *   FIXED: the admin-defined price
 * markup = org.markupOverride ?? model.markupMultiplier ?? default_markup.
 * All decimal inputs are plain strings (use Prisma Decimal `.toFixed()`, never `.toString()`).
 */
import { mulDecimalsCeil } from './decimal';
import { MICROS_PER_BRL } from './money';

export type PriceModeValue = 'AUTO' | 'FIXED';

export type ModelPriceInput = {
  priceMode: PriceModeValue;
  inputCostUsdPerM: string;
  cachedInputCostUsdPerM: string | null;
  outputCostUsdPerM: string;
  markupMultiplier: string | null;
  inputPriceMicrosPerM: bigint | null;
  outputPriceMicrosPerM: bigint | null;
};

export type PricingContext = {
  usdBrlRate: string;
  defaultMarkup: string;
  orgMarkupOverride?: string | null;
};

export type ModelPrices = {
  inputPerM: bigint;
  cachedInputPerM: bigint;
  outputPerM: bigint;
  markup: string;
};

/** Provider cost converted to BRL micros per 1M tokens (ceil). */
export function costBrlPerM(costUsdPerM: string, usdBrlRate: string): bigint {
  return mulDecimalsCeil([costUsdPerM, usdBrlRate], MICROS_PER_BRL);
}

export function effectiveMarkup(
  model: Pick<ModelPriceInput, 'markupMultiplier'>,
  ctx: PricingContext,
) {
  return ctx.orgMarkupOverride ?? model.markupMultiplier ?? ctx.defaultMarkup;
}

export function modelPrices(model: ModelPriceInput, ctx: PricingContext): ModelPrices {
  const markup = effectiveMarkup(model, ctx);
  if (model.priceMode === 'FIXED') {
    if (model.inputPriceMicrosPerM == null || model.outputPriceMicrosPerM == null) {
      throw new Error('FIXED price mode requires input and output prices');
    }
    // No separate fixed price for cached tokens: they use the fixed input price.
    return {
      inputPerM: model.inputPriceMicrosPerM,
      cachedInputPerM: model.inputPriceMicrosPerM,
      outputPerM: model.outputPriceMicrosPerM,
      markup,
    };
  }
  const auto = (cost: string) => mulDecimalsCeil([cost, ctx.usdBrlRate, markup], MICROS_PER_BRL);
  const inputPerM = auto(model.inputCostUsdPerM);
  return {
    inputPerM,
    cachedInputPerM:
      model.cachedInputCostUsdPerM != null ? auto(model.cachedInputCostUsdPerM) : inputPerM,
    outputPerM: auto(model.outputCostUsdPerM),
    markup,
  };
}

/** Gross margin in basis points (10000 = 100%) of a price over its cost. Negative = loss. */
export function marginBps(priceMicros: bigint, costMicros: bigint): number {
  if (priceMicros <= 0n) return 0;
  return Number(((priceMicros - costMicros) * 10_000n) / priceMicros);
}

export function formatBps(bps: number): string {
  return `${(bps / 100).toFixed(1).replace('.', ',')}%`;
}
