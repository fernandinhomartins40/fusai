import { describe, expect, it } from 'vitest';
import { readSseData } from './sse';

function streamOf(...parts: string[]) {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const p of parts) controller.enqueue(encoder.encode(p));
      controller.close();
    },
  });
}

async function collect(stream: ReadableStream<Uint8Array>) {
  const out: string[] = [];
  for await (const d of readSseData(stream)) out.push(d);
  return out;
}

describe('readSseData', () => {
  it('yields data payloads across arbitrary chunk boundaries', async () => {
    const out = await collect(
      streamOf('data: {"a"', ':1}\n\n', 'data: {"b":2}\r\n\r', '\ndata: [DONE]\n\n'),
    );
    expect(out).toEqual(['{"a":1}', '{"b":2}']);
  });

  it('ignores comments and stops at [DONE]', async () => {
    const out = await collect(
      streamOf(
        ': OPENROUTER PROCESSING\n\n',
        'data: {"x":1}\n\n',
        'data: [DONE]\n\n',
        'data: {"late":1}\n\n',
      ),
    );
    expect(out).toEqual(['{"x":1}']);
  });

  it('joins multi-line data and flushes a final event without blank line', async () => {
    const out = await collect(streamOf('data: line1\ndata: line2\n\ndata: tail'));
    expect(out).toEqual(['line1\nline2', 'tail']);
  });
});
