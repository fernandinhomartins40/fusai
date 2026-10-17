import { randomUUID } from 'node:crypto';
import type { CreditPackage, PrismaClient } from '@fusai/db';
import {
  appUserAdjustSchema,
  projectPackageSchema,
  projectPackageUpdateSchema,
} from '@fusai/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { audit } from '../../lib/audit';
import type { Env } from '../../lib/env';
import { HttpError, notFound } from '../../lib/errors';
import { currentUser } from '../../lib/session';
import { serializeAppUser } from '../app-users/service';
import { applyLedger } from '../billing/wallet';
import { deliverWebhook, emitEvent, resendWebhook } from '../webhooks-out/service';
import { requireMembership } from './membership';

type Options = { prisma: PrismaClient; env: Env; encryptionKey: Buffer };

const EDITORS = ['OWNER', 'ADMIN', 'DEVELOPER'] as const;
const MANAGERS = ['OWNER', 'ADMIN'] as const;
const PAGE_SIZE = 50;

export function serializePackage(p: CreditPackage) {
  return {
    id: p.id,
    name: p.name,
    priceCents: p.priceCents,
    creditMicros: p.creditMicros.toString(),
    bonusMicros: p.bonusMicros.toString(),
    highlight: p.highlight,
    active: p.active,
    sortOrder: p.sortOrder,
  };
}

/** Project tabs "Pacotes de créditos", "Usuários finais" and the webhook delivery log (PRD §12). */
export const dashboardEndUserRoutes: FastifyPluginAsyncZod<Options> = async (app, opts) => {
  const { prisma, env, encryptionKey } = opts;
  const deliverOpts = { encryptionKey, production: env.NODE_ENV === 'production' };

  async function projectFor(
    userId: string,
    projectId: string,
    roles?: readonly ('OWNER' | 'ADMIN' | 'DEVELOPER')[],
  ) {
    const project = await prisma.project.findUnique({ where: { id: projectId } });
    if (!project) throw notFound('Projeto não encontrado');
    await requireMembership(prisma, userId, project.orgId, roles);
    return project;
  }

  const projectParams = z.object({ projectId: z.string().min(1) });
  const packageParams = projectParams.extend({ packageId: z.string().min(1) });
  const appUserParams = projectParams.extend({ appUserId: z.string().min(1) });
  const hookParams = projectParams.extend({ hookId: z.string().min(1) });

  // ---- Credit packages sold to end users ----
  app.get(
    '/internal/projects/:projectId/packages',
    { schema: { params: projectParams } },
    async (req) => {
      const project = await projectFor(currentUser(req).id, req.params.projectId);
      const packages = await prisma.creditPackage.findMany({
        where: { projectId: project.id },
        orderBy: [{ sortOrder: 'asc' }, { priceCents: 'asc' }],
      });
      return { packages: packages.map(serializePackage) };
    },
  );

  app.post(
    '/internal/projects/:projectId/packages',
    { schema: { params: projectParams, body: projectPackageSchema } },
    async (req, reply) => {
      const project = await projectFor(currentUser(req).id, req.params.projectId, EDITORS);
      if ((await prisma.creditPackage.count({ where: { projectId: project.id } })) >= 20) {
        throw new HttpError(400, 'too_many_packages', 'Limite de 20 pacotes por projeto');
      }
      const body = req.body;
      const pkg = await prisma.creditPackage.create({
        data: {
          ...body,
          projectId: project.id,
          creditMicros: BigInt(body.creditMicros),
          bonusMicros: BigInt(body.bonusMicros),
        },
      });
      await audit(prisma, req, 'package.create', pkg.id, { projectId: project.id });
      return reply.status(201).send(serializePackage(pkg));
    },
  );

  app.patch(
    '/internal/projects/:projectId/packages/:packageId',
    { schema: { params: packageParams, body: projectPackageUpdateSchema } },
    async (req) => {
      const project = await projectFor(currentUser(req).id, req.params.projectId, EDITORS);
      const { creditMicros, bonusMicros, ...rest } = req.body;
      const res = await prisma.creditPackage.updateMany({
        where: { id: req.params.packageId, projectId: project.id },
        data: {
          ...rest,
          ...(creditMicros !== undefined ? { creditMicros: BigInt(creditMicros) } : {}),
          ...(bonusMicros !== undefined ? { bonusMicros: BigInt(bonusMicros) } : {}),
        },
      });
      if (res.count === 0) throw notFound('Pacote não encontrado');
      await audit(prisma, req, 'package.update', req.params.packageId, {
        fields: Object.keys(req.body),
      });
      const pkg = await prisma.creditPackage.findUniqueOrThrow({
        where: { id: req.params.packageId },
      });
      return serializePackage(pkg);
    },
  );

  // Payments keep their package id: a package that was ever bought is deactivated, not deleted.
  app.delete(
    '/internal/projects/:projectId/packages/:packageId',
    { schema: { params: packageParams } },
    async (req) => {
      const project = await projectFor(currentUser(req).id, req.params.projectId, EDITORS);
      const pkg = await prisma.creditPackage.findFirst({
        where: { id: req.params.packageId, projectId: project.id },
      });
      if (!pkg) throw notFound('Pacote não encontrado');
      const used = await prisma.payment.count({ where: { packageId: pkg.id } });
      if (used > 0) {
        await prisma.creditPackage.update({ where: { id: pkg.id }, data: { active: false } });
      } else {
        await prisma.creditPackage.delete({ where: { id: pkg.id } });
      }
      await audit(prisma, req, 'package.delete', pkg.id, { deactivated: used > 0 });
      return { deleted: used === 0, deactivated: used > 0 };
    },
  );

  // ---- End users ----
  const appUsersQuery = z.object({
    q: z.string().trim().max(120).optional(),
    cursor: z.string().max(64).optional(),
  });

  app.get(
    '/internal/projects/:projectId/app-users',
    { schema: { params: projectParams, querystring: appUsersQuery } },
    async (req) => {
      const project = await projectFor(currentUser(req).id, req.params.projectId);
      const { q, cursor } = req.query;
      const users = await prisma.appUser.findMany({
        where: {
          projectId: project.id,
          ...(q
            ? {
                OR: [
                  { externalId: { contains: q, mode: 'insensitive' } },
                  { email: { contains: q, mode: 'insensitive' } },
                  { name: { contains: q, mode: 'insensitive' } },
                ],
              }
            : {}),
        },
        include: { wallet: true },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: PAGE_SIZE + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      const page = users.slice(0, PAGE_SIZE);
      const total = await prisma.appUser.count({ where: { projectId: project.id } });
      return {
        total,
        appUsers: page.map((u) => serializeAppUser(u, u.wallet)),
        nextCursor: users.length > PAGE_SIZE ? (page.at(-1)?.id ?? null) : null,
      };
    },
  );

  app.post(
    '/internal/projects/:projectId/app-users/:appUserId/adjust',
    { schema: { params: appUserParams, body: appUserAdjustSchema } },
    async (req) => {
      const user = currentUser(req);
      const project = await projectFor(user.id, req.params.projectId, MANAGERS);
      const appUser = await prisma.appUser.findFirst({
        where: { id: req.params.appUserId, projectId: project.id },
        include: { wallet: true },
      });
      if (!appUser?.wallet) throw notFound('Usuário final não encontrado');
      const amount = BigInt(req.body.amountMicros);
      const walletId = appUser.wallet.id;
      const wallet = await prisma.$transaction(async (tx) => {
        const entry = await applyLedger(tx, {
          walletId,
          type: amount > 0n ? 'BONUS' : 'ADJUSTMENT',
          amountMicros: amount,
          referenceType: 'manual_adjustment',
          referenceId: randomUUID(),
          description: req.body.description,
          actorId: user.id,
        });
        // A removal cannot take more than the end user has available.
        const after = await tx.wallet.findUniqueOrThrow({ where: { id: walletId } });
        if (amount < 0n && entry.balanceAfter - after.reservedMicros < 0n) {
          throw new HttpError(400, 'insufficient_balance', 'O usuário não tem esse saldo');
        }
        return after;
      });
      await audit(prisma, req, 'app_user.adjust', appUser.id, {
        projectId: project.id,
        amountMicros: amount.toString(),
      });
      return serializeAppUser(appUser, wallet);
    },
  );

  // ---- Outbound webhook deliveries ----
  const hooksQuery = z.object({
    status: z.enum(['pending', 'delivered', 'failed']).optional(),
    cursor: z.string().max(64).optional(),
  });

  app.get(
    '/internal/projects/:projectId/webhooks',
    { schema: { params: projectParams, querystring: hooksQuery } },
    async (req) => {
      const project = await projectFor(currentUser(req).id, req.params.projectId);
      const { status, cursor } = req.query;
      const hooks = await prisma.outboundWebhook.findMany({
        where: { projectId: project.id, ...(status ? { status } : {}) },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: PAGE_SIZE + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      const page = hooks.slice(0, PAGE_SIZE);
      return {
        webhookUrl: project.webhookUrl,
        deliveries: page.map((h) => ({
          id: h.id,
          event: h.event,
          status: h.status,
          attempts: h.attempts,
          responseStatus: h.responseStatus,
          lastError: h.lastError,
          nextAttemptAt: h.status === 'pending' ? h.nextAttemptAt.toISOString() : null,
          deliveredAt: h.deliveredAt?.toISOString() ?? null,
          createdAt: h.createdAt.toISOString(),
          payload: h.payload,
        })),
        nextCursor: hooks.length > PAGE_SIZE ? (page.at(-1)?.id ?? null) : null,
      };
    },
  );

  // Resend and test deliver right away, so the developer sees the result on screen.
  app.post(
    '/internal/projects/:projectId/webhooks/:hookId/resend',
    { schema: { params: hookParams } },
    async (req) => {
      const project = await projectFor(currentUser(req).id, req.params.projectId, EDITORS);
      if (!(await resendWebhook(prisma, req.params.hookId, project.id)))
        throw notFound('Entrega não encontrada');
      await deliverWebhook(prisma, req.params.hookId, deliverOpts);
      await audit(prisma, req, 'webhook.resend', req.params.hookId);
      const hook = await prisma.outboundWebhook.findUniqueOrThrow({
        where: { id: req.params.hookId },
      });
      return {
        status: hook.status,
        responseStatus: hook.responseStatus,
        lastError: hook.lastError,
      };
    },
  );

  app.post(
    '/internal/projects/:projectId/webhooks/test',
    { schema: { params: projectParams } },
    async (req) => {
      const project = await projectFor(currentUser(req).id, req.params.projectId, EDITORS);
      if (!project.webhookUrl) {
        throw new HttpError(400, 'webhook_url_required', 'Cadastre a URL do webhook primeiro');
      }
      const hook = await emitEvent(prisma, project.id, 'test.ping', {
        message: 'Webhook de teste da fusai',
      });
      if (!hook) throw new HttpError(400, 'webhook_url_required', 'Cadastre a URL do webhook');
      await deliverWebhook(prisma, hook.id, deliverOpts);
      const after = await prisma.outboundWebhook.findUniqueOrThrow({ where: { id: hook.id } });
      return {
        status: after.status,
        responseStatus: after.responseStatus,
        lastError: after.lastError,
      };
    },
  );
};
