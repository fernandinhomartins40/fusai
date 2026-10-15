import { verifyWebhook } from '@fuseai/sdk/server';
import { NextResponse } from 'next/server';
import { receivedWebhooks } from '@/lib/fuse-server';

/** FuseAI → your server. Always verify X-Fuse-Signature against the RAW body. */
export async function POST(req: Request) {
  const secret = process.env.FUSE_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: 'FUSE_WEBHOOK_SECRET ausente' }, { status: 500 });
  const raw = await req.text();
  const event = await verifyWebhook(secret, req.headers.get('x-fuse-signature'), raw);
  if (!event) return NextResponse.json({ error: 'assinatura inválida' }, { status: 401 });

  // Idempotent: the same event id may arrive more than once (retries).
  if (!receivedWebhooks.some((e) => e.id === event.id)) {
    receivedWebhooks.unshift({
      id: event.id,
      type: event.type,
      created: event.created,
      data: event.data,
    });
    receivedWebhooks.splice(50);
  }
  return NextResponse.json({ received: true });
}

/** Demo only: lets the page show what arrived. */
export async function GET() {
  return NextResponse.json({ events: receivedWebhooks });
}
