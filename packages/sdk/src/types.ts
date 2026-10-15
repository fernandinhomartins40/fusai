/** Values in micro-reais (1 BRL = 1_000_000) travel as strings: they do not fit a JS number safely. */
export type Micros = string;

export type ChatMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null | Array<Record<string, unknown>>;
  name?: string;
  tool_call_id?: string;
  tool_calls?: unknown[];
};

export type ChatCompletionRequest = {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  max_tokens?: number;
  tools?: unknown[];
  tool_choice?: unknown;
  response_format?: unknown;
  [key: string]: unknown;
};

export type Usage = {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  prompt_tokens_details?: { cached_tokens?: number };
};

export type ChatCompletion = {
  id: string;
  object: 'chat.completion';
  created: number;
  model: string;
  choices: {
    index: number;
    message: { role: 'assistant'; content: string | null; tool_calls?: unknown[] };
    finish_reason: string | null;
  }[];
  usage?: Usage;
};

export type ChatCompletionChunk = {
  id: string;
  object: 'chat.completion.chunk';
  created: number;
  model: string;
  choices: {
    index: number;
    delta: { role?: string; content?: string | null; tool_calls?: unknown[] };
    finish_reason: string | null;
  }[];
  usage?: Usage | null;
};

export type Balance = {
  object: 'balance';
  currency: 'BRL';
  owner: 'organization' | 'app_user';
  balance_micros: Micros;
  reserved_micros: Micros;
  available_micros: Micros;
};

export type CreditPackage = {
  id: string;
  name: string;
  priceCents: number;
  creditMicros: Micros;
  bonusMicros: Micros;
  highlight: boolean;
};

export type CheckoutStatus =
  | 'PENDING'
  | 'CONFIRMED'
  | 'RECEIVED'
  | 'REFUNDED'
  | 'EXPIRED'
  | 'CANCELED'
  | 'FAILED';

export type Checkout = {
  object: 'checkout';
  checkoutId: string;
  status: CheckoutStatus;
  amountCents: number;
  creditMicros: Micros;
  packageId: string | null;
  packageName: string | null;
  /** Pix "copia e cola" (only while PENDING). */
  copyPaste: string | null;
  /** PNG QR code, base64 without the data: prefix (only while PENDING). */
  qrBase64: string | null;
  expiresAt: string | null;
  paidAt: string | null;
  /** fusai hosted page for this checkout (open in the browser / in-app browser). */
  hostedUrl: string;
  createdAt: string;
};

export type CreateCheckoutInput = {
  packageId: string;
  /** Required with the secret key (backend); omitted with a session token. */
  externalId?: string;
  /** Where the hosted page sends the buyer after paying: https URL or app deep link. */
  returnUrl?: string;
  /** Buyer CPF/CNPJ and name (required by the PSP the first time). */
  document?: string;
  name?: string;
  email?: string;
  /** Same key = same checkout (avoids duplicates on double clicks / retries). */
  idempotencyKey?: string;
};

export type AppUser = {
  id: string;
  externalId: string;
  email: string | null;
  name: string | null;
  balanceMicros: Micros;
  availableMicros: Micros;
  createdAt: string;
};

export type SessionToken = {
  object: 'session_token';
  token: string;
  expiresAt: string;
  scopes: string[];
};

/** Payload of a fusai webhook (header X-Fuse-Event = type). */
export type WebhookEvent<T = Record<string, unknown>> = {
  id: string;
  type:
    | 'payment.received'
    | 'payment.expired'
    | 'payment.refunded'
    | 'app_user.credited'
    | 'balance.low'
    | 'usage.limit_reached'
    | 'test.ping';
  created: string;
  data: T;
};

export type Model = {
  id: string;
  object: 'model';
  name: string;
  description: string | null;
  context_window: number;
  max_output_tokens: number;
  capabilities: { tools: boolean; vision: boolean; reasoning: boolean };
  pricing: {
    currency: 'BRL';
    unit: '1M tokens';
    input: string;
    cached_input: string;
    output: string;
  };
};
