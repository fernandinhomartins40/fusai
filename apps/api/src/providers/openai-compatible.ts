import { readSseData } from './sse';
import {
  type ChatChunk,
  type ChatCompletion,
  type LlmProvider,
  type NormalizedChatRequest,
  UpstreamError,
} from './types';

export type ProviderConfig = { baseUrl: string; apiKey: string; timeoutMs: number };

/**
 * Only errors caused by the client's request are final (400/413/422). Everything else —
 * 401/402/403/404 (our provider key, credit or model mapping), 408/409/429 and 5xx —
 * may succeed on a fallback provider.
 */
const RETRYABLE = (status: number) => ![400, 413, 422].includes(status);

/** One adapter for every provider: they all expose OpenAI-compatible `/chat/completions`. */
export class OpenAICompatibleProvider implements LlmProvider {
  constructor(private readonly config: ProviderConfig) {}

  async chat(req: NormalizedChatRequest, signal: AbortSignal): Promise<ChatCompletion> {
    const res = await this.post({ ...req.body, stream: false }, signal);
    try {
      return (await res.json()) as ChatCompletion;
    } catch {
      throw new UpstreamError('Resposta inválida do provedor', res.status, true);
    }
  }

  async *chatStream(req: NormalizedChatRequest, signal: AbortSignal): AsyncIterable<ChatChunk> {
    const res = await this.post(
      { ...req.body, stream: true, stream_options: { include_usage: true } },
      signal,
    );
    if (!res.body) throw new UpstreamError('Stream vazio do provedor', res.status, true);
    for await (const data of readSseData(res.body)) {
      let chunk: ChatChunk;
      try {
        chunk = JSON.parse(data) as ChatChunk;
      } catch {
        continue; // ignore malformed keep-alives
      }
      if (chunk && typeof chunk === 'object' && 'error' in chunk && chunk.error) {
        throw new UpstreamError('Erro do provedor durante o stream', null, false);
      }
      yield chunk;
    }
  }

  private async post(body: Record<string, unknown>, signal: AbortSignal): Promise<Response> {
    const timeout = AbortSignal.timeout(this.config.timeoutMs);
    let res: Response;
    try {
      res = await fetch(`${this.config.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.config.apiKey}`,
          'content-type': 'application/json',
          accept: body.stream ? 'text/event-stream' : 'application/json',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.any([signal, timeout]),
      });
    } catch (err) {
      if (signal.aborted) throw err; // client went away: not a provider failure
      const timedOut = timeout.aborted;
      throw new UpstreamError(
        timedOut ? 'Tempo esgotado no provedor' : 'Falha de conexão com o provedor',
        null,
        true,
        timedOut ? 'upstream_timeout' : 'upstream_unreachable',
      );
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new UpstreamError(upstreamMessage(text, res.status), res.status, RETRYABLE(res.status));
    }
    return res;
  }
}

/** Extracts a short message from an upstream error body (never echoes our credentials). */
function upstreamMessage(text: string, status: number): string {
  let message = '';
  try {
    const parsed = JSON.parse(text);
    message = parsed?.error?.message ?? parsed?.message ?? '';
  } catch {}
  message = String(message)
    .replace(/(sk|key|Bearer)[-_ ]?[A-Za-z0-9._-]{8,}/gi, '[redacted]')
    .slice(0, 300);
  return message || `O provedor respondeu ${status}`;
}
