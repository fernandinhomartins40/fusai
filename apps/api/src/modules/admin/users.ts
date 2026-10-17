import type { Prisma, PrismaClient } from '@fusai/db';
import { adminListQuerySchema, userBanSchema } from '@fusai/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { audit } from '../../lib/audit';
import { HttpError, notFound } from '../../lib/errors';

const idParams = z.object({ id: z.string().min(1) });

/**
 * Platform users (people who sign in). Ban = `banned` flag read by the Better Auth admin plugin
 * on every new session, plus all current sessions revoked. Super admins cannot be banned here.
 */
export const adminUserRoutes: FastifyPluginAsyncZod<{ prisma: PrismaClient }> = async (
  app,
  { prisma },
) => {
  app.get(
    '/internal/admin/users',
    { schema: { querystring: adminListQuerySchema } },
    async (req) => {
      const { q, cursor } = req.query;
      const limit = req.query.limit ?? 30;
      const where: Prisma.UserWhereInput = q
        ? {
            OR: [
              { email: { contains: q, mode: 'insensitive' } },
              { name: { contains: q, mode: 'insensitive' } },
            ],
          }
        : {};
      const rows = await prisma.user.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        include: {
          memberships: { include: { org: { select: { id: true, name: true } } } },
          sessions: {
            where: { expiresAt: { gt: new Date() } },
            orderBy: { updatedAt: 'desc' },
            take: 1,
            select: { updatedAt: true },
          },
        },
      });
      const page = rows.slice(0, limit);
      return {
        items: page.map((u) => ({
          id: u.id,
          name: u.name,
          email: u.email,
          emailVerified: u.emailVerified,
          role: u.role,
          banned: !!u.banned,
          banReason: u.banReason,
          lastSeenAt: u.sessions[0]?.updatedAt.toISOString() ?? null,
          organizations: u.memberships.map((m) => ({ ...m.org, role: m.role })),
          createdAt: u.createdAt.toISOString(),
        })),
        nextCursor: rows.length > limit ? (page.at(-1)?.id ?? null) : null,
      };
    },
  );

  app.post(
    '/internal/admin/users/:id/ban',
    { schema: { params: idParams, body: userBanSchema } },
    async (req) => {
      const user = await prisma.user.findUnique({ where: { id: req.params.id } });
      if (!user) throw notFound('Usuário não encontrado');
      if (user.role === 'SUPER_ADMIN') {
        throw new HttpError(409, 'cannot_ban_admin', 'Não é possível bloquear um super admin.');
      }
      const [, sessions] = await prisma.$transaction([
        prisma.user.update({
          where: { id: user.id },
          data: { banned: true, banReason: req.body.reason, banExpires: null },
        }),
        prisma.session.deleteMany({ where: { userId: user.id } }),
      ]);
      await audit(prisma, req, 'user.ban', user.id, {
        reason: req.body.reason,
        sessionsRevoked: sessions.count,
      });
      return { banned: true, sessionsRevoked: sessions.count };
    },
  );

  app.post('/internal/admin/users/:id/unban', { schema: { params: idParams } }, async (req) => {
    const user = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!user) throw notFound('Usuário não encontrado');
    await prisma.user.update({
      where: { id: user.id },
      data: { banned: false, banReason: null, banExpires: null },
    });
    await audit(prisma, req, 'user.unban', user.id);
    return { banned: false };
  });

  /** Signs the user out everywhere (e.g. a leaked password). */
  app.post(
    '/internal/admin/users/:id/revoke-sessions',
    { schema: { params: idParams } },
    async (req) => {
      const user = await prisma.user.findUnique({ where: { id: req.params.id } });
      if (!user) throw notFound('Usuário não encontrado');
      const { count } = await prisma.session.deleteMany({ where: { userId: user.id } });
      await audit(prisma, req, 'user.revoke_sessions', user.id, { sessionsRevoked: count });
      return { sessionsRevoked: count };
    },
  );
};
