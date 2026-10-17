import { fromNodeHeaders } from 'better-auth/node';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Auth } from '../modules/auth/auth';
import type { Env } from './env';
import { forbidden, unauthorized } from './errors';

export type SessionUser = {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  role: 'USER' | 'SUPER_ADMIN';
  /** Set when a super admin is using this account via "entrar como cliente". */
  impersonatedBy: string | null;
};

declare module 'fastify' {
  interface FastifyRequest {
    user?: SessionUser;
  }
}

/** Builds preHandlers for cookie-authenticated dashboard routes (`/internal/*`). */
export function sessionGuards(env: Env, auth: Auth) {
  async function requireUser(req: FastifyRequest, _reply: FastifyReply) {
    // CSRF: mutating requests from browsers must come from the web app origin.
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      const origin = req.headers.origin;
      if (origin && origin !== env.APP_URL) throw forbidden('Origem não permitida');
    }
    const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
    if (!session) throw unauthorized();
    const { id, name, email, emailVerified } = session.user;
    const role =
      (session.user as { role?: string }).role === 'SUPER_ADMIN' ? 'SUPER_ADMIN' : 'USER';
    const impersonatedBy =
      (session.session as { impersonatedBy?: string | null }).impersonatedBy ?? null;
    req.user = { id, name, email, emailVerified, role, impersonatedBy };
  }

  async function requireSuperAdmin(req: FastifyRequest, reply: FastifyReply) {
    await requireUser(req, reply);
    if (req.user?.role !== 'SUPER_ADMIN') throw forbidden();
  }

  return { requireUser, requireSuperAdmin };
}

export function currentUser(req: FastifyRequest): SessionUser {
  if (!req.user) throw unauthorized();
  return req.user;
}
