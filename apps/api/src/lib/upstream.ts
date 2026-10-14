export type ConnectionTestResult = {
  ok: boolean;
  status: number | null;
  latencyMs: number;
  models: string[];
  error: string | null;
};

/**
 * Calls GET {baseUrl}/models on an OpenAI-compatible provider to validate the key.
 * The key is scrubbed from any error text before it is returned.
 */
export async function testProviderConnection(
  baseUrl: string,
  apiKey: string,
  timeoutMs = 15_000,
): Promise<ConnectionTestResult> {
  const started = performance.now();
  const scrub = (text: string) => text.split(apiKey).join('[redacted]').slice(0, 300);
  try {
    const res = await fetch(`${baseUrl}/models`, {
      headers: { authorization: `Bearer ${apiKey}`, accept: 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
    });
    const latencyMs = Math.round(performance.now() - started);
    const body = await res.text();
    if (!res.ok) {
      let message = body;
      try {
        const parsed = JSON.parse(body);
        message = parsed?.error?.message ?? parsed?.message ?? body;
      } catch {}
      return {
        ok: false,
        status: res.status,
        latencyMs,
        models: [],
        error: scrub(`HTTP ${res.status}: ${message}`),
      };
    }
    const parsed = JSON.parse(body) as { data?: { id?: unknown }[] };
    const models = (parsed.data ?? [])
      .map((m) => m.id)
      .filter((id): id is string => typeof id === 'string')
      .sort()
      .slice(0, 500);
    return { ok: true, status: res.status, latencyMs, models, error: null };
  } catch (err) {
    const latencyMs = Math.round(performance.now() - started);
    const message =
      err instanceof Error && err.name === 'TimeoutError'
        ? `Tempo esgotado após ${timeoutMs} ms`
        : `Falha de conexão: ${err instanceof Error ? err.message : String(err)}`;
    return { ok: false, status: null, latencyMs, models: [], error: scrub(message) };
  }
}
