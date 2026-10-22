export type DailyPoint = {
  day: string;
  requests: number;
  chargedMicros: string;
  promptTokens: number;
  completionTokens: number;
};

export type ModelUsage = {
  modelId: string;
  slug: string;
  name: string;
  requests: number;
  chargedMicros: string;
  promptTokens: number;
  completionTokens: number;
};

export type ProjectUsage = {
  projectId: string;
  name: string;
  requests: number;
  chargedMicros: string;
  promptTokens: number;
  completionTokens: number;
};

export type Overview = {
  today: string;
  wallet: { balanceMicros: string; reservedMicros: string; availableMicros: string };
  lowBalance: { thresholdMicros: string; isLow: boolean };
  billingType: 'PREPAID' | 'POSTPAID' | 'INTERNAL';
  activation: {
    hasProject: boolean;
    hasKey: boolean;
    hasCredits: boolean;
    hasFirstCall: boolean;
    projectId: string | null;
  };
  spend: { today: string; last7d: string; last30d: string };
  requests: { today: number; last7d: number; last30d: number };
  daily: DailyPoint[];
  byModel: ModelUsage[];
};

export type UsageReport = {
  from: string;
  to: string;
  totals: {
    requests: number;
    chargedMicros: string;
    promptTokens: number;
    completionTokens: number;
  };
  daily: DailyPoint[];
  byModel: ModelUsage[];
  byProject: ProjectUsage[];
};

export type LogItem = {
  id: string;
  requestId: string;
  createdAt: string;
  project: string;
  model: string;
  apiKey: { id: string; prefix: string; name: string } | null;
  promptTokens: number;
  cachedTokens: number;
  completionTokens: number;
  chargedMicros: string;
  latencyMs: number | null;
  ttftMs: number | null;
  stream: boolean;
  status: 'SUCCESS' | 'UPSTREAM_ERROR' | 'CLIENT_ERROR' | 'INSUFFICIENT_FUNDS' | 'RATE_LIMITED';
  errorCode: string | null;
};

export type OrgModel = {
  id: string;
  slug: string;
  name: string;
  contextWindow: number;
  inputPerM: string;
  outputPerM: string;
};

export type ProjectDetail = {
  id: string;
  orgId: string;
  name: string;
  slug: string;
  billingMode: 'ORG_WALLET' | 'END_USER_WALLET' | 'HYBRID';
  defaultModelId: string | null;
  allowedModelIds: string[];
  allowedOrigins: string[];
  webhookUrl: string | null;
  freeCreditMicros: string;
  createdAt: string;
};

export type OrgRole = 'OWNER' | 'ADMIN' | 'DEVELOPER' | 'BILLING';

export type TeamData = {
  myRole: OrgRole;
  members: { userId: string; name: string; email: string; role: OrgRole }[];
  invitations: { id: string; email: string; role: OrgRole; expiresAt: string; createdAt: string }[];
};

export type OrgSettings = {
  id: string;
  name: string;
  slug: string;
  document: string | null;
  phone: string | null;
  billingType: 'PREPAID' | 'POSTPAID' | 'INTERNAL';
  role: OrgRole;
  lowBalanceAlertMicros: string | null;
  defaultLowBalanceMicros: string;
  suggestedTopupCents: number | null;
  minTopupCents: number;
};
