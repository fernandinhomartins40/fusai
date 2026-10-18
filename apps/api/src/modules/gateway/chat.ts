import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import type { PrismaClient } from '@fusai/db';
import { estimateHoldMicros, type ModelPrices } from '@fusai/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { priceModel } from '../../lib/model-pricing';
import { slidingWindow } from '../../lib/rate-limit';
import type { RedisClient } from '../../lib/redis';
import type { SettingsStore } from '../../lib/settings';
import { OpenAICompatibleProvider } from '../../providers/openai-compatible';
import {
  type ChatChunk,
  type ChatCompletion,
  type ChatUsage,
  UpstreamError,
} from '../../providers/types';
import { reserve } from '../billing/wallet';
import { emitEvent } from '../webhooks-out/service';
import type { GatewayContext } from './auth';
import { AUTO_MODEL, autoCandidates, modelNeeds } from './auto-model';
import {
  finishRequest,
  monthlySpend,
  resolveBilling,
  type WalletTarget,
  ZERO_USAGE,
} from './billing';
import { type CatalogEntry, type CatalogStore, isServable } from './catalog';
import type { CircuitBreaker } from './circuit-breaker';
import {
  GatewayError,
  insufficientFunds,
  modelNotAllowed,
  modelNotFound,
  rateLimited,
  upstreamFailed,
} from './errors';
import { notifyOnce } from './notify-once';
import {
  estimatePromptTokensForHold,
  estimateUsage,
  normalizeUsage,
  publicUsage,
  type Usage,
} from './usage';

export const DEFAULT_RPM = 120;

export const chatBodySchema = z
  .object({
    model: z.string().min(1, 'Informe o modelo'),
    messages: z.array(z.object({ role: z.string() }).loose()).min(1, 'Envie ao menos uma mensagem'),
    stream: z.boolean().nullish(),
    stream_options: z.object({ include_usage: z.boolean().nullish() }).loose().nullish(),
    max_tokens: z.number().int().positive().nullish(),
    max_completion_tokens: z.number().int().positive().nullish(),
    n: z.literal(1, 'Somente n = 1 é suportado').nullish(),
  })
  .loose();
export type ChatBody = z.infer<typeof chatBodySchema>;

type Deps = {
  prisma: PrismaClient;
  catalog: CatalogStore;
  settings: SettingsStore;
  breaker: CircuitBreaker;
  redis: RedisClient;
};

class ClientAborted extends Error {}

export function createChatHandler(deps: Deps) {
  return async function chatCompletions(
    req: FastifyRequest,
    reply: FastifyReply,
    ctx: GatewayContext,
  ) {
    const body = req.body as ChatBody;
    const started = performance.now();
    const catalog = await deps.catalog.get();
    const settings = await deps.settings.get();
    const orgMarkup = ctx.org.markupOverride?.toFixed() ?? null;
    const pricesOf = (e: CatalogEntry) => priceModel(e.model, settings, orgMarkup);

    // 1. Resolve the model and check what this key may use.
    const inProject = (e: CatalogEntry) =>
      ctx.project.allowedModelIds.length === 0 || ctx.project.allowedModelIds.includes(e.model.id);
    const testKeyOk = (e: CatalogEntry) =>
      ctx.env === 'LIVE' || pricesOf(e).outputPerM <= BigInt(settings.test_key_max_output_micros);
    const allowed = (e: CatalogEntry) => inProject(e) && testKeyOk(e);
    // fuse/auto: the cheapest usable model that meets the request (tools, images), D-126.
    const auto =
      body.model === AUTO_MODEL
        ? autoCandidates(
            [...catalog.bySlug.values()].filter((e) => isServable(e) && allowed(e)),
            modelNeeds(body as Record<string, unknown>),
            pricesOf,
          )
        : null;
    if (auto && auto.length === 0) {
      throw new GatewayError(
        503,
        'model_unavailable',
        'Nenhum modelo disponível para fuse/auto com o que este pedido precisa (ferramentas ou imagens).',
      );
    }
    const requested = auto ? auto[0] : catalog.bySlug.get(body.model);
    if (!requested?.model.active) throw modelNotFound(body.model);
    if (!inProject(requested)) throw modelNotAllowed(body.model);
    if (!testKeyOk(requested)) {
      throw modelNotAllowed(
        body.model,
        'não está disponível para chaves de teste (use uma chave live)',
      );
    }

    // 2. Rate limit per key / end user (fails open if Redis is unavailable).
    const limit = ctx.rpmLimit ?? DEFAULT_RPM;
    const rl = await slidingWindow(deps.redis, ctx.rateKey, limit, 60_000).catch((err) => {
      req.log.warn({ err }, 'rate limiter unavailable');
      return null;
    });
    if (rl && !rl.allowed) throw rateLimited(rl.retryAfterMs);
    if (rl)
      reply
        .header('x-ratelimit-limit', String(limit))
        .header('x-ratelimit-remaining', String(rl.remaining));

    // 3. Candidates: requested model + fallbacks that are servable and allowed.
    const candidates: CatalogEntry[] = [];
    for (const e of auto ?? [
      requested,
      ...requested.model.fallbackModelIds.map((id) => catalog.byId.get(id)),
    ]) {
      if (isServable(e) && allowed(e) && !candidates.some((c) => c.model.id === e.model.id))
        candidates.push(e);
    }
    if (candidates.length === 0) {
      throw new GatewayError(
        503,
        'model_unavailable',
        `O modelo "${body.model}" está temporariamente indisponível.`,
      );
    }

    // 4. Hold = worst case across candidates (a fallback may cost more).
    const promptEstimate = estimatePromptTokensForHold(body);
    const maxTokens = body.max_completion_tokens ?? body.max_tokens ?? null;
    const hold = candidates.reduce((max, e) => {
      const p = pricesOf(e);
      const h = estimateHoldMicros({
        promptTokens: promptEstimate,
        maxTokens,
        modelMaxOutputTokens: e.model.maxOutputTokens,
        inputPerM: p.inputPerM,
        outputPerM: p.outputPerM,
      });
      return h > max ? h : max;
    }, 0n);

    const billing = resolveBilling(ctx);
    const usageId = randomUUID();
    reply.header('x-fuse-request-id', usageId);

    const key = ctx.key;
    if (key?.spendLimitMicros != null) {
      const spent = await monthlySpend(deps.prisma, key.id);
      if (spent + hold > key.spendLimitMicros) {
        await notifyOnce(deps.redis, `limit:${key.id}`, () =>
          emitEvent(deps.prisma, ctx.project.id, 'usage.limit_reached', {
            apiKey: { id: key.id, prefix: key.prefix, name: key.name },
            spendLimitMicros: key.spendLimitMicros?.toString(),
            spentMicros: spent.toString(),
          }),
        );
        throw new GatewayError(
          402,
          'spend_limit_reached',
          'Limite de gasto mensal desta chave atingido.',
        );
      }
    }

    const finish = (
      entry: CatalogEntry,
      usage: Usage,
      status: 'SUCCESS' | 'UPSTREAM_ERROR' | 'CLIENT_ERROR' | 'INSUFFICIENT_FUNDS',
      errorCode: string | null,
      ttftMs: number | null = null,
    ) =>
      finishRequest(deps.prisma, ctx, target, settings, usageId, {
        entry,
        prices: pricesOf(entry),
        usage,
        status,
        errorCode,
        latencyMs: Math.round(performance.now() - started),
        ttftMs,
        stream: !!body.stream,
      }).then((charged) => {
        if (charged > 0n && target?.owner === 'org') void checkLowBalance(target.walletId);
        return charged;
      });

    /** balance.low webhook when the org wallet crosses its alert threshold (once a day). */
    const checkLowBalance = async (walletId: string) => {
      const wallet = await deps.prisma.wallet.findUnique({ where: { id: walletId } });
      if (!wallet) return;
      const threshold =
        ctx.org.lowBalanceAlertMicros ?? BigInt(settings.low_balance_threshold_micros);
      const available = wallet.balanceMicros - wallet.reservedMicros;
      if (available >= threshold) return;
      await notifyOnce(deps.redis, `low:${ctx.org.id}:${ctx.project.id}`, () =>
        emitEvent(deps.prisma, ctx.project.id, 'balance.low', {
          availableMicros: available.toString(),
          thresholdMicros: threshold.toString(),
        }),
      );
    };

    // 5. Reserve (PRD §7.4) on the first wallet with enough balance (HYBRID: end user, then org).
    //    INTERNAL organizations skip it.
    let target: WalletTarget | null = null;
    if (billing.mode === 'wallet') {
      for (const candidate of billing.candidates) {
        const ok = await reserve(deps.prisma, {
          walletId: candidate.walletId,
          requestId: usageId,
          amountMicros: hold,
          creditLimitMicros: candidate.creditLimitMicros,
        });
        if (ok) {
          target = candidate;
          break;
        }
      }
      if (!target) {
        await deps.prisma.usageLog.create({
          data: {
            requestId: usageId,
            orgId: ctx.org.id,
            projectId: ctx.project.id,
            apiKeyId: ctx.key?.id ?? null,
            appUserId: ctx.appUser?.id ?? null,
            walletId: billing.candidates[0]?.walletId ?? null,
            modelId: requested.model.id,
            providerId: requested.provider.id,
            status: 'INSUFFICIENT_FUNDS',
            errorCode: 'insufficient_funds',
          },
        });
        throw insufficientFunds();
      }
    }

    // 6. Abort upstream if the client disconnects.
    const controller = new AbortController();
    const onClose = () => {
      if (!reply.raw.writableFinished) controller.abort();
    };
    reply.raw.on('close', onClose);

    const { model: _model, stream_options: _so, ...rest } = body;
    const upstreamBody = (e: CatalogEntry) => ({ ...rest, model: e.model.upstreamModel });
    const providerFor = (e: CatalogEntry) =>
      new OpenAICompatibleProvider({
        baseUrl: e.provider.baseUrl,
        apiKey: e.apiKey as string,
        timeoutMs: e.provider.timeoutMs,
      });

    /** Tries candidates in order; falls back only on retryable errors before any output. */
    async function withFallback<T>(
      attempt: (e: CatalogEntry) => Promise<T>,
    ): Promise<{ entry: CatalogEntry; value: T }> {
      const open = await Promise.all(candidates.map((c) => deps.breaker.isOpen(c.provider.id)));
      const ordered = candidates.filter((_, i) => !open[i]);
      const list = ordered.length ? ordered : candidates.slice(0, 1); // all open: probe the primary
      let last: UpstreamError | null = null;
      for (const entry of list) {
        try {
          return { entry, value: await attempt(entry) };
        } catch (err) {
          if (controller.signal.aborted) throw new ClientAborted();
          if (!(err instanceof UpstreamError)) throw err;
          last = err;
          if (!err.retryable) throw err;
          await deps.breaker.recordFailure(entry.provider.id);
          req.log.warn(
            { provider: entry.provider.slug, status: err.status, code: err.code },
            'upstream failed, trying fallback',
          );
        }
      }
      throw last ?? upstreamFailed();
    }

    try {
      if (body.stream) {
        const { entry, value: first } = await withFallback(async (e) => {
          const iterator = providerFor(e)
            .chatStream({ body: upstreamBody(e) }, controller.signal)
            [Symbol.asyncIterator]();
          return { iterator, first: await iterator.next() };
        });
        return await pipeStream({
          req,
          reply,
          body,
          entry,
          usageId,
          started,
          controller,
          first,
          finish,
          breaker: deps.breaker,
          prices: pricesOf(entry),
        });
      }

      const { entry, value: completion } = await withFallback((e) =>
        providerFor(e).chat({ body: upstreamBody(e) }, controller.signal),
      );
      const usage = completion.usage
        ? normalizeUsage(completion.usage)
        : estimateUsage(body.messages, completionText(completion));
      await finish(entry, usage, 'SUCCESS', completion.usage ? null : 'usage_estimated');
      return reply.send(publicCompletion(completion, entry, usageId, pricesOf(entry)));
    } catch (err) {
      if (reply.raw.headersSent) {
        // The stream already started and settled itself; nothing else can be sent.
        req.log.error({ err }, 'error after stream started');
        return reply;
      }
      if (err instanceof ClientAborted || controller.signal.aborted) {
        // The provider already processed the prompt: charge the estimated prompt tokens.
        await finish(
          requested,
          estimateUsage(body.messages, ''),
          'CLIENT_ERROR',
          'client_disconnected',
        );
        return reply;
      }
      if (err instanceof UpstreamError && !err.retryable) {
        await finish(requested, ZERO_USAGE, 'CLIENT_ERROR', `upstream_${err.status ?? 'error'}`);
        throw new GatewayError(400, 'invalid_request', err.message);
      }
      await finish(
        requested,
        ZERO_USAGE,
        'UPSTREAM_ERROR',
        err instanceof UpstreamError ? err.code : 'internal_error',
      );
      if (err instanceof UpstreamError) throw upstreamFailed();
      throw err;
    } finally {
      reply.raw.off('close', onClose);
    }
  };
}

function completionText(c: ChatCompletion): string {
  return (c.choices as { message?: { content?: unknown; reasoning_content?: unknown } }[])
    .map((ch) =>
      [ch.message?.reasoning_content, ch.message?.content]
        .filter((x) => typeof x === 'string')
        .join(''),
    )
    .join('');
}

/** Hides upstream details: our id, our public model slug, no provider fields. */
function publicCompletion(
  c: ChatCompletion,
  entry: CatalogEntry,
  usageId: string,
  prices: ModelPrices,
) {
  const { provider: _p, usage, ...rest } = c;
  return {
    ...rest,
    id: `chatcmpl-${usageId}`,
    model: entry.model.slug,
    ...(usage ? { usage: publicUsage(normalizeUsage(usage), prices) } : {}),
  };
}

type PipeInput = {
  req: FastifyRequest;
  reply: FastifyReply;
  body: ChatBody;
  entry: CatalogEntry;
  usageId: string;
  started: number;
  controller: AbortController;
  first: { iterator: AsyncIterator<ChatChunk>; first: IteratorResult<ChatChunk> };
  finish: (
    entry: CatalogEntry,
    usage: Usage,
    status: 'SUCCESS' | 'UPSTREAM_ERROR' | 'CLIENT_ERROR',
    errorCode: string | null,
    ttftMs?: number | null,
  ) => Promise<bigint>;
  breaker: CircuitBreaker;
  prices: ModelPrices;
};

/** Relays the upstream SSE chunk by chunk, then settles with the reported (or estimated) usage. */
async function pipeStream(p: PipeInput) {
  const { reply, body, entry, usageId, controller } = p;
  const wantsUsage = !!body.stream_options?.include_usage;
  const res = reply.raw;
  reply.hijack();
  res.writeHead(200, {
    ...(reply.getHeaders() as Record<string, string>),
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
    'x-request-id': p.req.id,
  });

  let text = '';
  let usage: ChatUsage | null = null;
  let ttft: number | null = null;
  let status: 'SUCCESS' | 'UPSTREAM_ERROR' | 'CLIENT_ERROR' = 'SUCCESS';
  let errorCode: string | null = null;

  const write = async (payload: string) => {
    if (res.destroyed || controller.signal.aborted) return;
    if (!res.write(payload)) await once(res, 'drain').catch(() => {});
  };

  const relay = async (chunk: ChatChunk) => {
    if (chunk.usage) usage = chunk.usage;
    for (const choice of chunk.choices ?? []) {
      const piece = `${choice.delta?.reasoning_content ?? ''}${choice.delta?.content ?? ''}`;
      if (piece) {
        text += piece;
        ttft ??= Math.round(performance.now() - p.started);
      }
    }
    const usageOnly = (!chunk.choices || chunk.choices.length === 0) && !!chunk.usage;
    if (usageOnly && !wantsUsage) return;
    const { provider: _p, usage: chunkUsage, ...rest } = chunk;
    const out: Record<string, unknown> = {
      ...rest,
      id: `chatcmpl-${usageId}`,
      model: entry.model.slug,
    };
    if (wantsUsage)
      out.usage = chunkUsage ? publicUsage(normalizeUsage(chunkUsage), p.prices) : null;
    await write(`data: ${JSON.stringify(out)}\n\n`);
  };

  try {
    if (!p.first.first.done) await relay(p.first.first.value);
    while (true) {
      const next = await p.first.iterator.next();
      if (next.done) break;
      await relay(next.value);
    }
  } catch (err) {
    if (controller.signal.aborted) {
      status = 'CLIENT_ERROR';
      errorCode = 'client_disconnected';
    } else {
      status = 'UPSTREAM_ERROR';
      errorCode = err instanceof UpstreamError ? err.code : 'stream_error';
      await p.breaker.recordFailure(entry.provider.id);
      p.req.log.warn({ err, provider: entry.provider.slug }, 'stream interrupted');
      await write(
        `data: ${JSON.stringify({ error: { message: 'O provedor interrompeu a resposta.', type: 'api_error', code: 'upstream_error' } })}\n\n`,
      );
    }
  }
  if (controller.signal.aborted && status === 'SUCCESS') {
    status = 'CLIENT_ERROR';
    errorCode = 'client_disconnected';
  }

  // Charge what was generated (provider usage, or a tokenizer estimate) BEFORE [DONE], so a
  // client that reads its balance right after the stream already sees the debit.
  const final = usage ? normalizeUsage(usage) : estimateUsage(body.messages, text);
  const code = usage ? errorCode : [errorCode, 'usage_estimated'].filter(Boolean).join(':');
  try {
    await p.finish(entry, final, status, code || null, ttft);
  } finally {
    await write('data: [DONE]\n\n');
    if (!res.destroyed) res.end();
  }
  return reply;
}
