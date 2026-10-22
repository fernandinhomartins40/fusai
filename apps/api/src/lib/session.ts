import { fromNodeHeaders } from 'better-auth/node';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Auth } from '../modules/auth/auth';
import type { Env } from './env';
import { forbidden, HttpError, unauthorized } from './errors';

export type SessionUser = {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  role: 'USER' | 'SUPER_ADMIN';
  /** Set when a super admin is using this account via "entrar como cliente". */
  impersonatedBy: string | null;
  /** Authenticator app (TOTP) turned on for this account. */
  twoFactorEnabled: boolean;
  /** This session passed the TOTP check (required for SUPER_ADMIN on /admin). */
  mfaVerified: boolean;
};

/**
 * Routes a session still waiting for the authenticator code can use: the web app reads
 * `/internal/me` to know it must ask for the code. The code itself goes to /api/auth.
 */
const MFA_PENDING_ALLOWED = new Set(['/internal/me']);

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
    const twoFactorEnabled = (session.user as { twoFactorEnabled?: boolean | null })
      .twoFactorEnabled;
    const mfaVerifiedAt = (session.session as { mfaVerifiedAt?: Date | null }).mfaVerifiedAt;
    req.user = {
      id,
      name,
      email,
      emailVerified,
      role,
      impersonatedBy,
      twoFactorEnabled: twoFactorEnabled === true,
      mfaVerified: Boolean(mfaVerifiedAt),
    };
    // A sign-in that skipped the code (Google) is not complete for accounts with 2FA on.
    // Impersonation sessions are exempt: the super admin already proved the second factor.
    if (
      req.user.twoFactorEnabled &&
      !req.user.mfaVerified &&
      !impersonatedBy &&
      !MFA_PENDING_ALLOWED.has(req.routeOptions.url ?? '')
    )
      throw new HttpError(
        403,
        'mfa_required',
        'Confirme o código do app autenticador para continuar.',
      );
  }

  async function requireSuperAdmin(req: FastifyRequest, reply: FastifyReply) {
    await requireUser(req, reply);
    if (req.user?.role !== 'SUPER_ADMIN') throw forbidden();
    // PIE S-05: the admin panel needs a session confirmed with the authenticator app.
    if (!req.user.mfaVerified)
      throw new HttpError(
        403,
        'mfa_required',
        'Confirme a verificação em duas etapas para usar o painel admin.',
      );
  }

  return { requireUser, requireSuperAdmin };
}

export function currentUser(req: FastifyRequest): SessionUser {
  if (!req.user) throw unauthorized();
  return req.user;
}
