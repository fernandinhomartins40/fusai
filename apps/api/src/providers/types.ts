/** OpenAI-compatible shapes shared by all providers (PRD §7.2). */

export type ChatUsage = {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens?: number;
  prompt_tokens_details?: { cached_tokens?: number } | null;
  completion_tokens_details?: { reasoning_tokens?: number } | null;
  /** DeepSeek reports cache hits with its own fields. */
  prompt_cache_hit_tokens?: number;
};

export type ChatCompletion = {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: unknown[];
  usage?: ChatUsage | null;
  [key: string]: unknown;
};

export type ChatChunk = {
  id?: string;
  object?: string;
  created?: number;
  model?: string;
  choices?: {
    index?: number;
    delta?: { content?: string | null; reasoning_content?: string | null; [k: string]: unknown };
    finish_reason?: string | null;
  }[];
  usage?: ChatUsage | null;
  [key: string]: unknown;
};

/** Request body forwarded upstream: the client's OpenAI body with the upstream model name. */
export type NormalizedChatRequest = { body: Record<string, unknown> & { model: string } };

export interface LlmProvider {
  chat(req: NormalizedChatRequest, signal: AbortSignal): Promise<ChatCompletion>;
  chatStream(req: NormalizedChatRequest, signal: AbortSignal): AsyncIterable<ChatChunk>;
}

/** Upstream failure. `retryable` = may try a fallback (429, 5xx, timeout, network). */
export class UpstreamError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly retryable: boolean,
    readonly code: string = 'upstream_error',
  ) {
    super(message);
  }
}
