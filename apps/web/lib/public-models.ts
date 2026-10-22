import 'server-only';
import { SERVER_API_URL } from './config';

export type PublicModel = {
  id: string;
  name: string;
  provider: string;
  description: string | null;
  context_window: number;
  max_output_tokens: number;
  capabilities: { tools: boolean; vision: boolean; reasoning: boolean };
  /** Decimal BRL strings per 1M tokens ("5.500000"). */
  pricing: { input: string; cached_input: string; output: string };
};

export type PublicCatalog = {
  models: PublicModel[];
  topup: { min_cents: number; fee_pct: string } | null;
};

/**
 * Active models with list prices from GET /public/models, refreshed every 5 minutes.
 * The marketing pages still render (without the table) when the API is unreachable.
 */
export async function getPublicCatalog(): Promise<PublicCatalog> {
  try {
    const res = await fetch(`${SERVER_API_URL}/public/models`, { next: { revalidate: 300 } });
    if (!res.ok) return { models: [], topup: null };
    const body = (await res.json()) as { data: PublicModel[]; topup?: PublicCatalog['topup'] };
    return { models: body.data, topup: body.topup ?? null };
  } catch {
    return { models: [], topup: null };
  }
}
