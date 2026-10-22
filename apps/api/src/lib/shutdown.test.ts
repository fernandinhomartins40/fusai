import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { closeGracefully } from './shutdown';

/** A route that streams two chunks `gapMs` apart (or never ends), like a chat stream. */
async function streamingServer(gapMs: number | null) {
  const app = Fastify();
  app.get('/stream', (_req, reply) => {
    reply.raw.writeHead(200, { 'content-type': 'text/event-stream' });
    reply.raw.write('data: first\n\n');
    if (gapMs !== null) setTimeout(() => reply.raw.end('data: last\n\n'), gapMs);
    return reply;
  });
  await app.listen({ host: '127.0.0.1', port: 0 });
  const { port } = app.server.address() as { port: number };
  return { app, url: `http://127.0.0.1:${port}/stream` };
}

async function readFirstChunk(res: Response) {
  const reader = (res.body as ReadableStream<Uint8Array>).getReader();
  const first = await reader.read();
  return { reader, text: new TextDecoder().decode(first.value) };
}

async function readRest(reader: ReadableStreamDefaultReader<Uint8Array>) {
  let text = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return text;
      text += new TextDecoder().decode(value);
    }
  } catch {
    return `${text}<cut>`;
  }
}

describe('closeGracefully (PIE V-04)', () => {
  it('lets a stream in flight finish and refuses new connections', async () => {
    const { app, url } = await streamingServer(400);
    const { reader, text } = await readFirstChunk(await fetch(url));
    expect(text).toContain('first');

    const closing = closeGracefully(app, 5_000);
    const rest = readRest(reader);
    expect(await closing).toBe(true);
    expect(await rest).toContain('last');
    await expect(fetch(url)).rejects.toThrow();
  });

  it('cuts streams that outlive the timeout', async () => {
    const { app, url } = await streamingServer(null);
    const { reader } = await readFirstChunk(await fetch(url));

    const started = Date.now();
    expect(await closeGracefully(app, 200)).toBe(false);
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(await readRest(reader)).toContain('<cut>');
  });
});
