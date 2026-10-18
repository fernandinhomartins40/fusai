import type {
  AppUser,
  Balance,
  ChatCompletion,
  ChatCompletionChunk,
  ChatCompletionRequest,
  Checkout,
  CreateCheckoutInput,
  CreateTopupInput,
  CreditPackage,
  Model,
  SessionToken,
  Topup,
  TopupOptions,
  UsageSummary,
} from './types';

export const DEFAULT_BASE_URL = 'https://api.fusai.com.br/v1';

/** Error in the OpenAI format returned by the gateway: `{ error: { message, type, code } }`. */
export class FusaiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly type = 'api_error',
  ) {
    super(message);
    this.name = 'FusaiError';
  }
}

export type FusaiOptions = {
  /**
   * Secret key `fai_live_…` — ONLY on your server. In browsers and apps use `sessionToken`.
   */
  apiKey?: string;
  /**
   * End-user session token `fai_st_…` (15 min). Pass a function to renew it automatically:
   * it is called again once when the API answers 401.
   */
  sessionToken?: string | (() => Promise<string>);
  baseUrl?: string;
  fetch?: typeof fetch;
};

type RequestOptions = { body?: unknown; headers?: Record<string, string>; signal?: AbortSignal };

/**
 * fusai client (PRD §9.3). Works in browsers, Node 18+ and React Native (needs `fetch`).
 * Chat is OpenAI-compatible: the official `openai` SDK also works with `baseURL`.
 */
export class Fusai {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private token: string | null = null;
  private pending: Promise<string> | null = null;

  constructor(private readonly options: FusaiOptions) {
    if (!options.apiKey && !options.sessionToken) {
      throw new Error('fusai: informe apiKey (servidor) ou sessionToken (app).');
    }
    if (options.apiKey && typeof window !== 'undefined' && typeof document !== 'undefined') {
      console.warn('fusai: não use a chave secreta no navegador. Use um session token.');
    }
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
    if (typeof options.sessionToken === 'string') this.token = options.sessionToken;
  }

  /**
   * Current credential. With a token function, concurrent callers share ONE in-flight fetch
   * (otherwise a page with several components would ask your backend for several tokens at once).
   * `stale` = the token that just got a 401: renew only if nobody renewed it already.
   */
  private async credential(stale?: string): Promise<string> {
    if (this.options.apiKey) return this.options.apiKey;
    const source = this.options.sessionToken;
    const needsNew = !this.token || (stale !== undefined && stale === this.token);
    if (typeof source === 'function' && needsNew) {
      this.pending ??= source().finally(() => {
        this.pending = null;
      });
      this.token = await this.pending;
    }
    if (!this.token) throw new Error('fusai: session token ausente.');
    return this.token;
  }

  private async raw(
    method: string,
    path: string,
    opts: RequestOptions = {},
    staleToken?: string,
  ): Promise<Response> {
    const credential = await this.credential(staleToken);
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${credential}`,
        ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...opts.headers,
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: opts.signal,
    });
    const renewable = typeof this.options.sessionToken === 'function' && !this.options.apiKey;
    if (res.status === 401 && renewable && staleToken === undefined) {
      await res.body?.cancel().catch(() => {});
      return this.raw(method, path, opts, credential);
    }
    if (!res.ok) {
      const data = (await res.json().catch(() => null)) as {
        error?: { message?: string; code?: string; type?: string };
      } | null;
      throw new FusaiError(
        res.status,
        data?.error?.code ?? `http_${res.status}`,
        data?.error?.message ?? `Erro HTTP ${res.status}`,
        data?.error?.type,
      );
    }
    return res;
  }

  private async json<T>(method: string, path: string, opts?: RequestOptions): Promise<T> {
    return (await (await this.raw(method, path, opts)).json()) as T;
  }

  readonly chat = {
    completions: {
      /** Non-streaming chat completion. */
      create: (body: ChatCompletionRequest, opts: { signal?: AbortSignal } = {}) =>
        this.json<ChatCompletion>('POST', '/chat/completions', {
          body: { ...body, stream: false },
          signal: opts.signal,
        }),
      /** Streaming: `for await (const chunk of fuse.chat.completions.stream({...}))`. */
      stream: (body: ChatCompletionRequest, opts: { signal?: AbortSignal } = {}) =>
        this.streamChat(body, opts.signal),
    },
  };

  private async *streamChat(
    body: ChatCompletionRequest,
    signal?: AbortSignal,
  ): AsyncGenerator<ChatCompletionChunk> {
    const res = await this.raw('POST', '/chat/completions', {
      body: { ...body, stream: true, stream_options: { include_usage: true } },
      signal,
    });
    if (!res.body) throw new FusaiError(500, 'no_stream', 'Resposta sem stream');
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = '';
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) return;
        buffer += value;
        let idx = buffer.indexOf('\n\n');
        while (idx !== -1) {
          const event = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          for (const line of event.split('\n')) {
            if (!line.startsWith('data:')) continue;
            const data = line.slice(5).trim();
            if (data === '[DONE]') return;
            const parsed = JSON.parse(data) as ChatCompletionChunk & {
              error?: { message: string; code?: string };
            };
            if (parsed.error) {
              throw new FusaiError(500, parsed.error.code ?? 'stream_error', parsed.error.message);
            }
            yield parsed;
          }
          idx = buffer.indexOf('\n\n');
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  /** Models this credential can use, with BRL prices per 1M tokens. */
  async models(opts: { signal?: AbortSignal } = {}) {
    return (await this.json<{ data: Model[] }>('GET', '/models', opts)).data;
  }

  /** Balance of the end user (session token / X-Fuse-User) or of the organization. */
  balance(opts: { signal?: AbortSignal } = {}) {
    return this.json<Balance>('GET', '/balance', opts);
  }

  /** Credit packages the project sells to its end users. */
  async packages(opts: { signal?: AbortSignal } = {}) {
    return (await this.json<{ data: CreditPackage[] }>('GET', '/packages', opts)).data;
  }

  readonly checkout = {
    /** Creates a Pix charge for a package. Show the QR / copy-paste or open `hostedUrl`. */
    createPix: (input: CreateCheckoutInput) => {
      const { idempotencyKey, ...body } = input;
      return this.json<Checkout>('POST', '/checkout/pix', {
        body,
        headers: idempotencyKey ? { 'idempotency-key': idempotencyKey } : undefined,
      });
    },
    get: (checkoutId: string, opts: { signal?: AbortSignal } = {}) =>
      this.json<Checkout>('GET', `/checkout/${encodeURIComponent(checkoutId)}`, opts),
    /**
     * Polls every `intervalMs` (default 3 s) until the checkout leaves PENDING.
     * Resolves with the final checkout (RECEIVED = paid; EXPIRED/CANCELED = not paid).
     */
    waitForPayment: async (
      checkoutId: string,
      opts: { intervalMs?: number; signal?: AbortSignal; onUpdate?: (c: Checkout) => void } = {},
    ): Promise<Checkout> => {
      const interval = opts.intervalMs ?? 3000;
      while (true) {
        const current = await this.checkout.get(checkoutId, { signal: opts.signal });
        opts.onUpdate?.(current);
        if (current.status !== 'PENDING') return current;
        await sleep(interval, opts.signal);
      }
    },
  };

  /** Server only (secret key): consumption of this key's project, by model (default: 30 days). */
  usage(opts: { from?: string | Date; to?: string | Date; signal?: AbortSignal } = {}) {
    const q = new URLSearchParams();
    if (opts.from) q.set('from', new Date(opts.from).toISOString());
    if (opts.to) q.set('to', new Date(opts.to).toISOString());
    return this.json<UsageSummary>('GET', `/usage${q.size ? `?${q}` : ''}`, opts);
  }

  /**
   * Server only (secret key): credits for YOUR organization, paid with Pix from inside your app
   * ("uso próprio"). The QR / copy-paste can be shown in your UI or the payer can open `hostedUrl`.
   */
  readonly topups = {
    options: (opts: { signal?: AbortSignal } = {}) =>
      this.json<TopupOptions>('GET', '/topup-options', opts),
    create: (input: CreateTopupInput) => {
      const { idempotencyKey, ...body } = input;
      return this.json<Topup>('POST', '/topups', {
        body,
        headers: idempotencyKey ? { 'idempotency-key': idempotencyKey } : undefined,
      });
    },
    get: (topupId: string, opts: { signal?: AbortSignal } = {}) =>
      this.json<Topup>('GET', `/topups/${encodeURIComponent(topupId)}`, opts),
    /** Last 20 top-ups of the organization (without QR codes). */
    list: async (opts: { signal?: AbortSignal } = {}) =>
      (await this.json<{ data: Topup[] }>('GET', '/topups', opts)).data,
    /** Polls every `intervalMs` (default 3 s) until the top-up leaves PENDING. */
    waitForPayment: async (
      topupId: string,
      opts: { intervalMs?: number; signal?: AbortSignal; onUpdate?: (t: Topup) => void } = {},
    ): Promise<Topup> => {
      const interval = opts.intervalMs ?? 3000;
      while (true) {
        const current = await this.topups.get(topupId, { signal: opts.signal });
        opts.onUpdate?.(current);
        if (current.status !== 'PENDING') return current;
        await sleep(interval, opts.signal);
      }
    },
  };

  /** Server only (secret key with scope app_users). */
  readonly appUsers = {
    upsert: (input: { externalId: string; email?: string; name?: string; document?: string }) =>
      this.json<AppUser>('POST', '/app-users', { body: input }),
    get: (externalId: string) =>
      this.json<AppUser>('GET', `/app-users/${encodeURIComponent(externalId)}`),
    /** Short-lived token (15 min) for this end user's browser / app. */
    createSessionToken: (externalId: string) =>
      this.json<SessionToken>('POST', `/app-users/${encodeURIComponent(externalId)}/session-token`),
  };
}

function sleep(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}
