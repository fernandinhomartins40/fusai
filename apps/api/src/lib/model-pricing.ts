import type { Model } from '@fusai/db';
import {
  costBrlPerM,
  type ModelPriceInput,
  type ModelPrices,
  marginBps,
  modelPrices,
  type Settings,
} from '@fusai/shared';

type Decimalish = { toFixed(): string };

const dec = (value: Decimalish | null): string | null => (value == null ? null : value.toFixed());

/** Maps a Prisma model to the pure pricing input (Decimal -> plain string, never exponent form). */
export function toPriceInput(model: Model): ModelPriceInput {
  return {
    priceMode: model.priceMode,
    inputCostUsdPerM: model.inputCostUsdPerM.toFixed(),
    cachedInputCostUsdPerM: dec(model.cachedInputCostUsdPerM),
    outputCostUsdPerM: model.outputCostUsdPerM.toFixed(),
    markupMultiplier: dec(model.markupMultiplier),
    inputPriceMicrosPerM: model.inputPriceMicrosPerM,
    outputPriceMicrosPerM: model.outputPriceMicrosPerM,
  };
}

export function priceModel(
  model: Model,
  settings: Settings,
  orgMarkupOverride?: string | null,
): ModelPrices {
  return modelPrices(toPriceInput(model), {
    usdBrlRate: settings.usd_brl_rate,
    defaultMarkup: settings.default_markup,
    orgMarkupOverride,
  });
}

/** Price, cost and margin summary for the admin panel (all micros as strings). */
export function pricingSummary(model: Model, settings: Settings) {
  const prices = priceModel(model, settings);
  const input = toPriceInput(model);
  const inputCost = costBrlPerM(input.inputCostUsdPerM, settings.usd_brl_rate);
  const outputCost = costBrlPerM(input.outputCostUsdPerM, settings.usd_brl_rate);
  return {
    markup: prices.markup,
    inputPerM: prices.inputPerM.toString(),
    cachedInputPerM: prices.cachedInputPerM.toString(),
    outputPerM: prices.outputPerM.toString(),
    inputCostBrlPerM: inputCost.toString(),
    outputCostBrlPerM: outputCost.toString(),
    inputMarginBps: marginBps(prices.inputPerM, inputCost),
    outputMarginBps: marginBps(prices.outputPerM, outputCost),
  };
}
