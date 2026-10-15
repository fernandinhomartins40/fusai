import { randomUUID } from 'node:crypto';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { fuseServer } from '@/lib/fuse-server';

/**
 * Your backend: identify the signed-in user (here a demo cookie), make sure the FuseAI end user
 * exists, and hand the browser a short-lived session token (15 min). The secret key stays here.
 */
export async function POST() {
  const jar = await cookies();
  let userId = jar.get('demo_user')?.value;
  if (!userId) {
    userId = `demo-${randomUUID().slice(0, 8)}`;
    jar.set('demo_user', userId, { httpOnly: true, sameSite: 'lax', maxAge: 60 * 60 * 24 * 365 });
  }
  const fuse = fuseServer();
  await fuse.appUsers.upsert({ externalId: userId, name: 'Usuário Demo' });
  const { token, expiresAt } = await fuse.appUsers.createSessionToken(userId);
  return NextResponse.json({ token, expiresAt, userId });
}
