import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * Fake OpenAI-compatible provider. Behavior is chosen by the upstream model name:
 * - `echo`         normal answer "Olá do FuseAI!" with usage {12, 8}
 * - `no-usage`     answer without usage (forces estimation)
 * - `fail-500`     HTTP 500 (retryable -> fallback)
 * - `bad-request`  HTTP 400 (client error -> no fallback)
 * - `slow`         stream of 200 tokens, one every 20ms (to test client disconnects)
 */
export type FakeRequest = {
  model: string;
  stream: boolean;
  body: Record<string, unknown>;
  auth: string;
};

export async function startFakeLlm(validKey: string) {
  const requests: FakeRequest[] = [];
  const aborted: string[] = [];

  const server: Server = createServer(async (req, res) => {
    const body = JSON.parse(await readBody(req)) as Record<string, unknown>;
    const model = String(body.model);
    const stream = body.stream === true;
    const auth = (req.headers.authorization ?? '').replace(/^Bearer /, '');
    requests.push({ model, stream, body, auth });
    res.on('close', () => {
      if (!res.writableFinished) aborted.push(model);
    });

    if (auth !== validKey) return json(res, 401, { error: { message: 'Invalid API key' } });
    if (model === 'fail-500')
      return json(res, 500, { error: { message: 'internal upstream error' } });
    if (model === 'bad-request')
      return json(res, 400, { error: { message: 'messages: invalid role "robot"' } });

    const words =
      model === 'slow'
        ? Array.from({ length: 200 }, (_, i) => `t${i} `)
        : ['Olá ', 'do ', 'FuseAI!'];
    const usage = { prompt_tokens: 12, completion_tokens: 8, total_tokens: 20 };
    const base = {
      id: 'upstream-123',
      created: 1_700_000_000,
      model,
      provider: 'SecretUpstreamCo',
    };

    if (!stream) {
      return json(res, 200, {
        ...base,
        object: 'chat.completion',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: words.join('') },
            finish_reason: 'stop',
          },
        ],
        ...(model === 'no-usage' ? {} : { usage }),
      });
    }

    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const send = (obj: unknown) => res.write(`data: ${JSON.stringify(obj)}\n\n`);
    send({
      ...base,
      object: 'chat.completion.chunk',
      choices: [{ index: 0, delta: { role: 'assistant' } }],
    });
    for (const w of words) {
      if (res.destroyed) return;
      if (model === 'slow') await new Promise((r) => setTimeout(r, 20));
      send({
        ...base,
        object: 'chat.completion.chunk',
        choices: [{ index: 0, delta: { content: w } }],
      });
    }
    send({
      ...base,
      object: 'chat.completion.chunk',
      choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
    });
    const includeUsage = (body.stream_options as { include_usage?: boolean } | undefined)
      ?.include_usage;
    if (includeUsage && model !== 'no-usage') {
      send({ ...base, object: 'chat.completion.chunk', choices: [], usage });
    }
    res.end('data: [DONE]\n\n');
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${port}/v1`,
    requests,
    aborted,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function json(res: import('node:http').ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}
