export const dynamic = 'force-dynamic';

export function GET() {
  return Response.json({ status: 'ok', service: 'fuseai-web', time: new Date().toISOString() });
}
