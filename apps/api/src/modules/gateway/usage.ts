import type { Model } from '@fuseai/db';
import { costForTokens, type ModelPrices, mulDecimalsCeil } from '@fuseai/shared';
import { getEncoding, type Tiktoken } from 'js-tiktoken';
import type { ChatUsage } from '../../providers/types';

export type Usage = { prompt: number; cached: number; completion: number; reasoning: number };

const toInt = (v: unknown) =>
  typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;

/** Provider usage -> our counters (cached tokens: OpenAI details or DeepSeek cache-hit field). */
export function normalizeUsage(u: ChatUsage): Usage {
  const prompt = toInt(u.prompt_tokens);
  const cached = Math.min(
    prompt,
    toInt(u.prompt_tokens_details?.cached_tokens ?? u.prompt_cache_hit_tokens),
  );
  return {
    prompt,
    cached,
    completion: toInt(u.completion_tokens),
    reasoning: toInt(u.completion_tokens_details?.reasoning_tokens),
  };
}

/**
 * Usage in the standard OpenAI shape only: provider-specific fields (e.g. DeepSeek's
 * `prompt_cache_hit_tokens`) would reveal which upstream served the request.
 */
export function publicUsage(u: Usage) {
  return {
    prompt_tokens: u.prompt,
    completion_tokens: u.completion,
    total_tokens: u.prompt + u.completion,
    prompt_tokens_details: { cached_tokens: u.cached },
    completion_tokens_details: { reasoning_tokens: u.reasoning },
  };
}

/** Amount charged to the customer, rounded up per component. */
export function chargeFor(usage: Usage, prices: ModelPrices): bigint {
  return (
    costForTokens(usage.prompt - usage.cached, prices.inputPerM) +
    costForTokens(usage.cached, prices.cachedInputPerM) +
    costForTokens(usage.completion, prices.outputPerM)
  );
}

/** Real provider cost in micro-USD and in BRL micros at the current rate. */
export function providerCost(usage: Usage, model: Model, usdBrlRate: string) {
  const parts: [number, string][] = [
    [usage.prompt - usage.cached, model.inputCostUsdPerM.toFixed()],
    [usage.cached, (model.cachedInputCostUsdPerM ?? model.inputCostUsdPerM).toFixed()],
    [usage.completion, model.outputCostUsdPerM.toFixed()],
  ];
  let usd = 0n;
  let brl = 0n;
  for (const [tokens, perM] of parts) {
    if (tokens <= 0) continue;
    // tokens × (US$ per 1M) = micro-dollars
    usd += mulDecimalsCeil([perM], BigInt(tokens));
    brl += mulDecimalsCeil([perM, usdBrlRate], BigInt(tokens));
  }
  return { costUsdMicros: usd, costBrlMicros: brl };
}

/**
 * Cheap, conservative prompt size for the balance hold (no tokenizer on the hot path):
 * ~1 token per 3 characters of the serialized messages/tools, which over-estimates.
 */
export function estimatePromptTokensForHold(body: { messages: unknown; tools?: unknown }): number {
  const size =
    JSON.stringify(body.messages).length + (body.tools ? JSON.stringify(body.tools).length : 0);
  return Math.ceil(size / 3) + 16;
}

let encoder: Tiktoken | null = null;
function tokenizer(): Tiktoken {
  encoder ??= getEncoding('cl100k_base');
  return encoder;
}

export function countTokens(text: string): number {
  return text ? tokenizer().encode(text).length : 0;
}

/** Text of the prompt messages (string or multimodal text parts) for usage estimation. */
export function promptText(messages: unknown): string {
  if (!Array.isArray(messages)) return '';
  const parts: string[] = [];
  for (const m of messages as { content?: unknown; role?: unknown }[]) {
    if (typeof m?.role === 'string') parts.push(m.role);
    if (typeof m?.content === 'string') parts.push(m.content);
    else if (Array.isArray(m?.content)) {
      for (const p of m.content as { type?: string; text?: unknown }[]) {
        if (p?.type === 'text' && typeof p.text === 'string') parts.push(p.text);
      }
    }
  }
  return parts.join('\n');
}

/** Estimated usage when the provider does not report it (PRD §7.2, errorCode usage_estimated). */
export function estimateUsage(messages: unknown, completionText: string): Usage {
  const prompt =
    countTokens(promptText(messages)) + (Array.isArray(messages) ? messages.length * 4 : 0);
  return { prompt, cached: 0, completion: countTokens(completionText), reasoning: 0 };
}
