import type { FastifyInstance } from 'fastify';

/**
 * Graceful stop for deploys (PIE V-04): the server stops accepting connections, requests in
 * flight (chat streams included) keep running until they end or `timeoutMs` passes, and then
 * the remaining sockets are cut. Resolves true when everything finished in time.
 * Docker's `stop_grace_period` must be longer than `timeoutMs`.
 */
export async function closeGracefully(app: FastifyInstance, timeoutMs: number): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  const timedOut = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), timeoutMs);
  });
  const closed = app.close().then(() => true as const);
  // A keep-alive socket (nginx upstream) only becomes idle when its response ends; close()
  // drops idle sockets once, so keep dropping them or close() waits for the keep-alive timeout.
  const idle = setInterval(() => app.server.closeIdleConnections(), 250);
  try {
    const finished = await Promise.race([closed, timedOut]);
    if (!finished) app.server.closeAllConnections();
    return finished;
  } finally {
    clearTimeout(timer);
    clearInterval(idle);
  }
}
