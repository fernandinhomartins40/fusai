import 'server-only';
import { cookies } from 'next/headers';
import type { Me } from './session';

export const ORG_COOKIE = 'fuse_org';

export type CurrentOrg = Me['organizations'][number];

/** The organization being viewed: the cookie choice when the user still belongs to it, else the first. */
export async function getCurrentOrg(me: Me | null): Promise<CurrentOrg | null> {
  if (!me) return null;
  const chosen = (await cookies()).get(ORG_COOKIE)?.value;
  return me.organizations.find((o) => o.id === chosen) ?? me.organizations[0] ?? null;
}
