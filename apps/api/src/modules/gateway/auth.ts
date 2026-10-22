import type { ApiKey, AppUser, Organization, PrismaClient, Project, Wallet } from '@fusai/db';
import type { FastifyRequest } from 'fastify';
import { type ApiKeyScope, hashApiKey, hashesEqual, looksLikeApiKey } from '../api-keys/keys';
import { SESSION_TOKEN_PREFIX, verifySessionToken } from '../app-users/service';
import { GatewayError, invalidApiKey } from './errors';

export type GatewayAppUser = AppUser & { wallet: Wallet | null };

/** The API key whose monthly spend limit covers the request (PIE R-04). */
export type SpendKey = Pick<ApiKey, 'id' | 'prefix' | 'name' | 'spendLimitMicros'>;

/**
 * Who is calling /v1:
 * - `secret`: a project API key (customer backend). `X-Fuse-User` may name an end user.
 * - `session`: an end-user session token (browser / mobile app), short-lived and scoped.
 */
export type GatewayContext = {
  kind: 'secret' | 'session';
  key: ApiKey | null;
  project: Project;
  org: Organization & { wallet: Wallet | null };
  appUser: GatewayAppUser | null;
  /** The key itself, or the key that issued the session token (null for older tokens). */
  spendKey: SpendKey | null;
  scopes: string[];
  env: 'LIVE' | 'TEST';
  /** Rate-limit bucket: the API key, or the end user for session tokens. */
  rateKey: string;
  rpmLimit: number | null;
};

declare module 'fastify' {
  interface FastifyRequest {
    gateway?: GatewayContext;
  }
}

const LAST_USED_THROTTLE_MS = 60_000;
/** Session tokens are per end user: a modest default rate. */
const SESSION_RPM = 60;

function assertActive(org: Organization) {
  if (org.status === 'SUSPENDED') {
    throw new GatewayError(
      403,
      'account_suspended',
      'Conta suspensa. Fale com o suporte da fusai.',
    );
  }
}

/** PIE R-07: an end user who refunded or charged back credits already spent. */
function assertEndUserAllowed(user: AppUser) {
  if (user.blockedAt) {
    throw new GatewayError(
      403,
      'end_user_blocked',
      'Este usuário final está bloqueado após um estorno de créditos já usados. O dono do app pode desbloquear no painel da fusai.',
    );
  }
}

export function createGatewayAuth(prisma: PrismaClient, pepper: string, sessionSecret: string) {
  async function fromSessionToken(req: FastifyRequest, token: string): Promise<GatewayContext> {
    const claims = verifySessionToken(token, sessionSecret);
    if (!claims)
      throw invalidApiKey('Session token inválido ou expirado. Peça um novo ao seu backend.');
    // One joined query for user → project → org (+ wallets); the issuing key is read in parallel.
    // Scoping the key to the token's project matches the check on the user below.
    const [appUser, issuingKey] = await Promise.all([
      prisma.appUser.findUnique({
        where: { id: claims.sub },
        include: { wallet: true, project: { include: { org: { include: { wallet: true } } } } },
        relationLoadStrategy: 'join',
      }),
      claims.kid
        ? prisma.apiKey.findFirst({
            where: { id: claims.kid, projectId: claims.pid },
            select: { id: true, prefix: true, name: true, spendLimitMicros: true },
          })
        : null,
    ]);
    if (!appUser || appUser.projectId !== claims.pid)
      throw invalidApiKey('Session token inválido.');
    const { project, ...user } = appUser;
    const { org, ...proj } = project;
    assertActive(org);
    assertEndUserAllowed(user);
    // Browsers send Origin: only the project's allowed origins may use its session tokens.
    const origin = req.headers.origin;
    if (origin && !proj.allowedOrigins.includes(origin)) {
      throw new GatewayError(
        403,
        'origin_not_allowed',
        `A origem ${origin} não está nas origens permitidas do projeto (Configurações → Origens permitidas).`,
      );
    }
    return {
      kind: 'session',
      key: null,
      project: proj,
      org,
      appUser: user,
      spendKey: issuingKey,
      scopes: claims.scp,
      env: 'LIVE',
      rateKey: `st:${user.id}`,
      rpmLimit: SESSION_RPM,
    };
  }

  async function fromApiKey(req: FastifyRequest, token: string): Promise<GatewayContext> {
    if (!looksLikeApiKey(token)) throw invalidApiKey();
    // A secret key must live on a server. A browser Origin means it leaked into a front-end.
    if (req.headers.origin) {
      throw new GatewayError(
        403,
        'secret_key_in_browser',
        'Chaves secretas não podem ser usadas no navegador. Use um session token (POST /v1/app-users/:id/session-token).',
      );
    }
    const hash = hashApiKey(token, pepper);
    const key = await prisma.apiKey.findUnique({
      where: { hash },
      include: { project: { include: { org: { include: { wallet: true } } } } },
      // One SQL query instead of four (key, project, org, wallet).
      relationLoadStrategy: 'join',
    });
    if (!key || !hashesEqual(key.hash, hash)) throw invalidApiKey();
    if (key.revokedAt) throw invalidApiKey('Esta chave foi revogada.');
    if (key.expiresAt && key.expiresAt.getTime() <= Date.now())
      throw invalidApiKey('Esta chave expirou.');

    const { project, ...apiKey } = key;
    const { org, ...proj } = project;
    assertActive(org);

    if (!apiKey.lastUsedAt || Date.now() - apiKey.lastUsedAt.getTime() > LAST_USED_THROTTLE_MS) {
      prisma.apiKey
        .update({ where: { id: apiKey.id }, data: { lastUsedAt: new Date() } })
        .catch((err) => req.log.warn({ err }, 'failed to update lastUsedAt'));
    }

    // Backend calls on behalf of an end user (END_USER_WALLET / HYBRID).
    let appUser: GatewayAppUser | null = null;
    const externalId = req.headers['x-fuse-user'];
    if (typeof externalId === 'string' && externalId) {
      appUser = await prisma.appUser.findUnique({
        where: { projectId_externalId: { projectId: proj.id, externalId } },
        include: { wallet: true },
      });
      if (!appUser) {
        throw new GatewayError(
          404,
          'app_user_not_found',
          `Usuário final "${externalId}" não encontrado. Crie com POST /v1/app-users.`,
        );
      }
      assertEndUserAllowed(appUser);
    }

    return {
      kind: 'secret',
      key: apiKey,
      project: proj,
      org,
      appUser,
      spendKey: apiKey,
      scopes: apiKey.scopes,
      env: apiKey.env,
      rateKey: `key:${apiKey.id}`,
      rpmLimit: apiKey.rpmLimit,
    };
  }

  return async function authenticate(req: FastifyRequest): Promise<GatewayContext> {
    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    if (!token) throw invalidApiKey('Envie a chave no header Authorization: Bearer fai_live_...');
    const ctx = token.startsWith(SESSION_TOKEN_PREFIX)
      ? await fromSessionToken(req, token)
      : await fromApiKey(req, token);
    req.gateway = ctx;
    return ctx;
  };
}

export function requireScope(ctx: GatewayContext, scope: ApiKeyScope | 'balance') {
  // Session tokens use "balance"; API keys the equivalent "billing:read".
  const ok =
    ctx.scopes.includes(scope) ||
    (scope === 'billing:read' && ctx.kind === 'session' && ctx.scopes.includes('balance'));
  if (!ok) {
    throw new GatewayError(
      403,
      'insufficient_scope',
      `Esta credencial não tem o escopo "${scope}".`,
    );
  }
}

export function requireSecretKey(ctx: GatewayContext) {
  if (ctx.kind !== 'secret') {
    throw new GatewayError(
      403,
      'secret_key_required',
      'Esta rota só aceita a chave secreta do projeto (no seu backend).',
    );
  }
}
