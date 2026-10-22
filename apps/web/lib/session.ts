import 'server-only';
import { cookies } from 'next/headers';
import { cache } from 'react';
import { SERVER_API_URL } from './config';

export type Me = {
  user: {
    id: string;
    name: string;
    email: string;
    role: 'USER' | 'SUPER_ADMIN';
    /** Super admin id while in "entrar como cliente". */
    impersonatedBy: string | null;
    /** Authenticator app (TOTP) turned on. */
    twoFactorEnabled: boolean;
    /** This session passed the TOTP check (required for /admin). */
    mfaVerified: boolean;
  };
  organizations: {
    id: string;
    name: string;
    slug: string;
    role: 'OWNER' | 'ADMIN' | 'DEVELOPER' | 'BILLING';
    status: 'ACTIVE' | 'SUSPENDED';
    billingType: 'PREPAID' | 'POSTPAID' | 'INTERNAL';
    balanceMicros: string;
    reservedMicros: string;
    projects: { id: string; name: string; slug: string; billingMode: string }[];
  }[];
};

/** Server-side fetch to the API forwarding the user's cookies. */
export async function serverApi<T>(path: string): Promise<{ status: number; data: T | null }> {
  const cookieHeader = (await cookies()).toString();
  const res = await fetch(`${SERVER_API_URL}${path}`, {
    headers: cookieHeader ? { cookie: cookieHeader } : {},
    cache: 'no-store',
  });
  return { status: res.status, data: res.ok ? ((await res.json()) as T) : null };
}

/** Current user + organizations, or null when signed out. Deduplicated per request. */
export const getMe = cache(async (): Promise<Me | null> => {
  const { data } = await serverApi<Me>('/internal/me');
  return data;
});
