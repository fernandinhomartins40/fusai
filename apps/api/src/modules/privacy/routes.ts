import type { PrismaClient } from '@fusai/db';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { audit } from '../../lib/audit';
import { accountDeletionEmail } from '../../lib/email-templates';
import type { Env } from '../../lib/env';
import { forbidden, HttpError } from '../../lib/errors';
import type { Mailer } from '../../lib/mailer';
import { slidingWindow } from '../../lib/rate-limit';
import type { RedisClient } from '../../lib/redis';
import { currentUser, type sessionGuards } from '../../lib/session';
import { deletionBlockers, deletionScheduledFor } from './deletion';
import { buildDataExport, exportToJson } from './export';
import { getRetentionDays, retentionSchema, setRetentionDays } from './retention';

type Options = {
  prisma: PrismaClient;
  env: Env;
  guards: ReturnType<typeof sessionGuards>;
  mailer: Mailer;
  redis: RedisClient;
};

const EXPORTS_PER_HOUR = 5;

/** LGPD self-service (PIE S-09): export my data and delete my account; retention for admins. */
export const privacyRoutes: FastifyPluginAsyncZod<Options> = async (
  app,
  { prisma, env, guards, mailer, redis },
) => {
  /** Data-subject rights belong to the person: not available while a super admin impersonates. */
  function selfUser(req: Parameters<typeof currentUser>[0]) {
    const user = currentUser(req);
    if (user.impersonatedBy) throw forbidden('Indisponível ao entrar como cliente');
    return user;
  }

  async function deletionStatus(userId: string) {
    const { deletionRequestedAt } = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { deletionRequestedAt: true },
    });
    return {
      requestedAt: deletionRequestedAt?.toISOString() ?? null,
      scheduledFor: deletionRequestedAt
        ? deletionScheduledFor(deletionRequestedAt).toISOString()
        : null,
      blockers: await deletionBlockers(prisma, userId),
    };
  }

  app.get('/internal/privacy/export', { onRequest: guards.requireUser }, async (req, reply) => {
    const user = selfUser(req);
    const rl = await slidingWindow(redis, `privacy-export:${user.id}`, EXPORTS_PER_HOUR, 3_600_000);
    if (!rl.allowed) {
      reply.header('retry-after', String(Math.ceil(rl.retryAfterMs / 1000)));
      throw new HttpError(429, 'rate_limited', 'Você já exportou várias vezes. Tente mais tarde.');
    }
    const data = await buildDataExport(prisma, user.id);
    await audit(prisma, req, 'privacy.export', user.id);
    const day = new Date().toISOString().slice(0, 10);
    return reply
      .header('content-type', 'application/json; charset=utf-8')
      .header('content-disposition', `attachment; filename="fusai-meus-dados-${day}.json"`)
      .header('cache-control', 'no-store')
      .send(exportToJson(data));
  });

  app.get('/internal/privacy/deletion', { onRequest: guards.requireUser }, async (req) =>
    deletionStatus(currentUser(req).id),
  );

  app.post(
    '/internal/privacy/deletion',
    {
      onRequest: guards.requireUser,
      schema: { body: z.object({ confirmEmail: z.string().trim().min(3).max(254) }) },
    },
    async (req, reply) => {
      const user = selfUser(req);
      if (req.body.confirmEmail.toLowerCase() !== user.email.toLowerCase()) {
        throw new HttpError(
          400,
          'confirmation_mismatch',
          'Digite o email da sua conta para confirmar.',
        );
      }
      const current = await deletionStatus(user.id);
      if (current.requestedAt) return reply.status(202).send(current);
      if (current.blockers.length > 0) {
        throw new HttpError(
          409,
          'deletion_blocked',
          current.blockers.map((b) => b.message).join(' '),
        );
      }
      const requestedAt = new Date();
      await prisma.user.update({
        where: { id: user.id },
        data: { deletionRequestedAt: requestedAt },
      });
      await audit(prisma, req, 'privacy.deletion_requested', user.id);
      const when = deletionScheduledFor(requestedAt).toLocaleDateString('pt-BR', {
        timeZone: 'America/Sao_Paulo',
      });
      await mailer
        .send(accountDeletionEmail(user.email, user.name, when, `${env.APP_URL}/app/configuracoes`))
        .catch((err) => req.log.warn({ err: (err as Error).message }, 'deletion email failed'));
      return reply.status(202).send(await deletionStatus(user.id));
    },
  );

  app.delete('/internal/privacy/deletion', { onRequest: guards.requireUser }, async (req) => {
    const user = selfUser(req);
    const { count } = await prisma.user.updateMany({
      where: { id: user.id, deletionRequestedAt: { not: null }, deletedAt: null },
      data: { deletionRequestedAt: null },
    });
    if (count > 0) await audit(prisma, req, 'privacy.deletion_cancelled', user.id);
    return deletionStatus(user.id);
  });

  app.get(
    '/internal/admin/privacy/retention',
    { onRequest: guards.requireSuperAdmin },
    async () => ({ days: await getRetentionDays(prisma) }),
  );

  app.put(
    '/internal/admin/privacy/retention',
    { onRequest: guards.requireSuperAdmin, schema: { body: retentionSchema } },
    async (req) => {
      const before = await getRetentionDays(prisma);
      await setRetentionDays(prisma, req.body.days);
      await audit(prisma, req, 'privacy.retention_update', null, {
        from: before,
        to: req.body.days,
      });
      return { days: req.body.days };
    },
  );
};
