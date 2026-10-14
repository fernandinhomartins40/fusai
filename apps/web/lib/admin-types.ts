/** Response shapes of the admin API (micros are digit strings). */

export type AdminProvider = {
  id: string;
  slug: string;
  name: string;
  baseUrl: string;
  status: 'ACTIVE' | 'DISABLED';
  priority: number;
  timeoutMs: number;
  hasKey: boolean;
  keyMask: string | null;
  keyError: boolean;
  modelCount: number;
};

export type ConnectionTest = {
  ok: boolean;
  status: number | null;
  latencyMs: number;
  models: string[];
  error: string | null;
};

export type AdminModel = {
  id: string;
  slug: string;
  displayName: string;
  description: string | null;
  provider: { id: string; name: string; slug: string; status: 'ACTIVE' | 'DISABLED' };
  upstreamModel: string;
  contextWindow: number;
  maxOutputTokens: number;
  inputCostUsdPerM: string;
  cachedInputCostUsdPerM: string | null;
  outputCostUsdPerM: string;
  priceMode: 'AUTO' | 'FIXED';
  markupMultiplier: string | null;
  inputPriceMicrosPerM: string | null;
  outputPriceMicrosPerM: string | null;
  supportsTools: boolean;
  supportsVision: boolean;
  supportsReasoning: boolean;
  fallbackModelIds: string[];
  active: boolean;
  public: boolean;
  sortOrder: number;
  pricing: {
    markup: string;
    inputPerM: string;
    cachedInputPerM: string;
    outputPerM: string;
    inputCostBrlPerM: string;
    outputCostBrlPerM: string;
    inputMarginBps: number;
    outputMarginBps: number;
  };
};

export type AdminSettings = {
  usd_brl_rate: string;
  default_markup: string;
  topup_fee_pct: string;
  min_topup_cents: number;
  low_balance_threshold_micros: string;
  welcome_bonus_micros: string;
  test_key_max_output_micros: string;
};
