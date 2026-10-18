import type { CatalogEntry } from './catalog';

/**
 * Virtual model (D-126): each request goes to the CHEAPEST active model that can serve it,
 * with the next cheapest ones as fallbacks. The default in every guide, SDK example and MCP.
 */
export const AUTO_MODEL = 'fuse/auto';
const AUTO_FALLBACKS = 3;

type Needs = { tools: boolean; vision: boolean };

/** What the request requires from the model (tools, images). */
export function modelNeeds(body: Record<string, unknown>): Needs {
  const tools = Array.isArray(body.tools) && body.tools.length > 0;
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const vision = messages.some(
    (m) =>
      Array.isArray((m as { content?: unknown }).content) &&
      ((m as { content: unknown[] }).content as { type?: unknown }[]).some(
        (part) => part?.type === 'image_url' || part?.type === 'input_image',
      ),
  );
  return { tools, vision };
}

const meets = (e: CatalogEntry, n: Needs) =>
  (!n.tools || e.model.supportsTools) && (!n.vision || e.model.supportsVision);

/** Price the customer pays per 1M input + 1M output tokens: the ranking key. */
export function priceKey(p: { inputPerM: bigint; outputPerM: bigint }): bigint {
  return p.inputPerM + p.outputPerM;
}

/** Cheapest first (ties by slug, so the choice is stable). */
export function rankCheapest<T extends CatalogEntry>(
  entries: T[],
  pricesOf: (e: CatalogEntry) => { inputPerM: bigint; outputPerM: bigint },
): T[] {
  return [...entries].sort((a, b) => {
    const d = priceKey(pricesOf(a)) - priceKey(pricesOf(b));
    return d < 0n ? -1 : d > 0n ? 1 : a.model.slug.localeCompare(b.model.slug);
  });
}

/** Candidates for `fuse/auto`: usable entries that meet the needs, cheapest first. */
export function autoCandidates(
  usable: CatalogEntry[],
  needs: Needs,
  pricesOf: (e: CatalogEntry) => { inputPerM: bigint; outputPerM: bigint },
): CatalogEntry[] {
  return rankCheapest(
    usable.filter((e) => meets(e, needs)),
    pricesOf,
  ).slice(0, AUTO_FALLBACKS);
}
