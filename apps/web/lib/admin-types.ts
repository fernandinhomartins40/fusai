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
  usd_brl_auto: 'true' | 'false';
};

/** GET /internal/admin/fx: automatic USD→BRL rate (PTAX). */
export type AdminFx = {
  auto: boolean;
  rate: string;
  rateUpdatedAt: string | null;
  lastRun: {
    status: 'updated' | 'rejected';
    at: string;
    metadata: { from?: string; to?: string; current?: string; quoted?: string } | null;
  } | null;
};

type MoneyRow = {
  chargedMicros: string;
  costMicros: string;
  marginMicros: string;
  /** "75.0" — null when nothing was charged. */
  marginPct: string | null;
};

export type AdminDashboard = {
  days: number;
  totals: MoneyRow & {
    requests: number;
    errors: number;
    receivedCents: number;
    refundedCents: number;
    payments: number;
  };
  daily: (MoneyRow & { day: string; requests: number; receivedCents: number })[];
  topCustomers: (MoneyRow & { orgId: string; name: string; requests: number })[];
  topModels: (MoneyRow & { modelId: string; slug: string; name: string; requests: number })[];
  providers: {
    id: string;
    name: string;
    slug: string;
    status: 'ACTIVE' | 'DISABLED';
    requests: number;
    errors: number;
    avgLatencyMs: number | null;
  }[];
  liability: { organizationsMicros: string; endUsersMicros: string };
  requestsPerMinute: number;
  counts: {
    organizations: number;
    suspended: number;
    newOrganizations: number;
    users: number;
    activeProviders: number;
    activeModels: number;
  };
};

export type Page<T> = { items: T[]; nextCursor: string | null };

export type AdminUser = {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  role: 'USER' | 'SUPER_ADMIN';
  banned: boolean;
  banReason: string | null;
  lastSeenAt: string | null;
  organizations: { id: string; name: string; role: string }[];
  createdAt: string;
};

export type AdminApiKey = {
  id: string;
  name: string;
  prefix: string;
  env: 'LIVE' | 'TEST';
  scopes: string[];
  project: { id: string; name: string };
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
};

export type AdminUsageRow = {
  id: string;
  requestId: string;
  createdAt: string;
  org: { id: string; name: string };
  model: string;
  provider: string;
  promptTokens: number;
  cachedTokens: number;
  completionTokens: number;
  costMicros: string;
  chargedMicros: string;
  latencyMs: number | null;
  stream: boolean;
  status: string;
  errorCode: string | null;
  endUser: boolean;
};

export type AdminWebhookEvent = {
  id: string;
  provider: string;
  type: string;
  eventKey: string;
  summary: {
    kind: string | null;
    providerPaymentId: string | null;
    externalRef: string | null;
    valueCents: number | null;
  };
  processedAt: string | null;
  error: string | null;
  createdAt: string;
};

export type AdminAuditEntry = {
  id: string;
  action: string;
  target: string | null;
  actor: { id: string; name: string | null; email: string | null } | null;
  metadata: Record<string, unknown> | null;
  ip: string | null;
  createdAt: string;
};

type Check = { ok: boolean; latencyMs: number | null; error?: string };

export type AdminSystem = {
  version: string;
  node: string;
  uptimeSeconds: number;
  time: string;
  database: Check;
  redis: Check;
  queue: Record<'waiting' | 'active' | 'delayed' | 'failed' | 'completed', number> | null;
  pendingInboundWebhooks: number;
  failedOutboundWebhooks: number;
  activeHolds: number;
  lastMigration: string | null;
};

export type AdminReadiness = {
  ready: boolean;
  checks: { id: string; label: string; ok: boolean; detail: string; href: string | null }[];
};

export type ProviderHealth = {
  providerId: string;
  requests: number;
  errors: number;
  errorPct: string | null;
  p95LatencyMs: number | null;
  circuitOpen: boolean;
};
