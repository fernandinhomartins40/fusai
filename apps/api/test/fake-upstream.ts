import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * Minimal OpenAI-compatible upstream for tests. Accepts only `validKey`; the error message
 * echoes the received key (like some real providers do) to prove we scrub it.
 */
export async function startFakeUpstream(validKey: string, models: string[]) {
  const server: Server = createServer((req, res) => {
    const key = (req.headers.authorization ?? '').replace(/^Bearer /, '');
    res.setHeader('content-type', 'application/json');
    if (req.url !== '/v1/models') {
      res.statusCode = 404;
      return res.end(JSON.stringify({ error: { message: 'not found' } }));
    }
    if (key !== validKey) {
      res.statusCode = 401;
      return res.end(JSON.stringify({ error: { message: `Incorrect API key provided: ${key}` } }));
    }
    res.end(
      JSON.stringify({ object: 'list', data: models.map((id) => ({ id, object: 'model' })) }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${port}/v1`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
