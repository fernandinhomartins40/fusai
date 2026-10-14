/**
 * Minimal Server-Sent Events reader for OpenAI-style streams: yields each `data:` payload,
 * stops at `[DONE]`, ignores comments (`: keep-alive`) and other fields.
 */
export async function* readSseData(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let data: string[] = [];
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newline = buffer.indexOf('\n');
      while (newline >= 0) {
        const line = buffer.slice(0, newline).replace(/\r$/, '');
        buffer = buffer.slice(newline + 1);
        if (line === '') {
          if (data.length) {
            const payload = data.join('\n');
            data = [];
            if (payload === '[DONE]') return;
            yield payload;
          }
        } else if (line.startsWith('data:')) {
          data.push(line.slice(5).replace(/^ /, ''));
        }
        newline = buffer.indexOf('\n');
      }
    }
    // Stream ended without a final newline/blank line: flush what is left.
    const last = buffer.replace(/\r$/, '');
    if (last.startsWith('data:')) data.push(last.slice(5).replace(/^ /, ''));
    const tail = data.join('\n');
    if (tail && tail !== '[DONE]') yield tail;
  } finally {
    reader.releaseLock();
  }
}
