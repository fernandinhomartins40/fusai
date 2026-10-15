import 'server-only';
import { Fusai } from '@fusai/sdk';

/** Server-side client with the SECRET key. Never import this file from a client component. */
export function fuseServer() {
  const apiKey = process.env.FUSAI_API_KEY;
  if (!apiKey) throw new Error('Defina FUSAI_API_KEY em .env.local');
  return new Fusai({
    apiKey,
    baseUrl: process.env.FUSAI_BASE_URL ?? 'http://localhost:4000/v1',
  });
}

/** Demo only: webhooks received, kept in memory (use your database in a real app). */
type Received = { id: string; type: string; created: string; data: unknown };
const store = globalThis as unknown as { __fuseWebhooks?: Received[] };
if (!store.__fuseWebhooks) store.__fuseWebhooks = [];
export const receivedWebhooks: Received[] = store.__fuseWebhooks;
