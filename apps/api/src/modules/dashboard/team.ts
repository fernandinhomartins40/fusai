import { createHash, randomBytes } from 'node:crypto';
import type { OrgRole, PrismaClient } from '@fuseai/db';
import { inviteSchema, memberRoleSchema } from '@fuseai/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { audit } from '../../lib/audit';
import { invitationEmail } from '../../lib/email-templates';
import type { Env } from '../../lib/env';
import { conflict, forbidden, HttpError, notFound } from '../../lib/errors';
import type { Mailer } from '../../lib/mailer';
import { currentUser } from '../../lib/session';
import { requireMembership } from './membership';

const INVITE_TTL_MS = 7 * 86_400_000;
const MANAGERS = ['OWNER', 'ADMIN'] as const;
const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

type Options = { prisma: PrismaClient; env: Env; mailer: Mailer };

/** Team: members, roles and email invitations (PRD §11.4 Equipe). */
export const dashboardTeamRoutes: FastifyPluginAsyncZod<Options> = async (
  app,
  { prisma, env, mailer },
) => {
  const orgParams = z.object({ orgId: z.string().min(1) });
  const memberParams = z.object({ orgId: z.string().min(1), userId: z.string().min(1) });

  /** ADMINs manage everyone but OWNERs; only OWNERs grant or touch the OWNER role. */
  function assertCanManage(actorRole: OrgRole, targetRole: OrgRole, newRole?: OrgRole) {
    if (actorRole === 'OWNER') return;
    if (targetRole === 'OWNER' || newRole === 'OWNER') {
      throw forbidden('Só donos podem gerenciar outros donos');
    }
  }

  async function assertNotLastOwner(orgId: string, userId: string) {
    const owners = await prisma.membership.findMany({
      where: { orgId, role: 'OWNER' },
      select: { userId: true },
    });
    if (owners.length === 1 && owners[0]?.userId === userId) {
      throw new HttpError(409, 'last_owner', 'A organização precisa de pelo menos um dono.');
    }
  }

  app.get(
    '/internal/organizations/:orgId/members',
    { schema: { params: orgParams } },
    async (req) => {
      const me = await requireMembership(prisma, currentUser(req).id, req.params.orgId);
      const [members, invitations] = await Promise.all([
        prisma.membership.findMany({
          where: { orgId: req.params.orgId },
          include: { user: { select: { id: true, name: true, email: true } } },
        }),
        prisma.invitation.findMany({
          where: {
            orgId: req.params.orgId,
            acceptedAt: null,
            revokedAt: null,
            expiresAt: { gt: new Date() },
          },
          orderBy: { createdAt: 'desc' },
        }),
      ]);
      const order: OrgRole[] = ['OWNER', 'ADMIN', 'DEVELOPER', 'BILLING'];
      return {
        myRole: me.role,
        members: members
          .sort(
            (a, b) =>
              order.indexOf(a.role) - order.indexOf(b.role) ||
              a.user.name.localeCompare(b.user.name),
          )
          .map((m) => ({
            userId: m.user.id,
            name: m.user.name,
            email: m.user.email,
            role: m.role,
          })),
        invitations: invitations.map((i) => ({
          id: i.id,
          email: i.email,
          role: i.role,
          expiresAt: i.expiresAt.toISOString(),
          createdAt: i.createdAt.toISOString(),
        })),
      };
    },
  );

  app.post(
    '/internal/organizations/:orgId/invitations',
    { schema: { params: orgParams, body: inviteSchema } },
    async (req, reply) => {
      const user = currentUser(req);
      const me = await requireMembership(prisma, user.id, req.params.orgId, MANAGERS);
      const { email, role } = req.body;
      assertCanManage(me.role, 'DEVELOPER', role);
      const existing = await prisma.membership.findFirst({
        where: { orgId: req.params.orgId, user: { email } },
      });
      if (existing) throw conflict('Esta pessoa já faz parte da organização');

      const org = await prisma.organization.findUniqueOrThrow({ where: { id: req.params.orgId } });
      const token = randomBytes(32).toString('base64url');
      const invitation = await prisma.$transaction(async (tx) => {
        // A new invitation replaces any pending one for the same email.
        await tx.invitation.updateMany({
          where: { orgId: org.id, email, acceptedAt: null, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        return tx.invitation.create({
          data: {
            orgId: org.id,
            email,
            role,
            tokenHash: hashToken(token),
            invitedById: user.id,
            expiresAt: new Date(Date.now() + INVITE_TTL_MS),
          },
        });
      });
      await mailer.send(
        invitationEmail(email, user.name, org.name, `${env.APP_URL}/convite/${token}`),
      );
      await audit(prisma, req, 'team.invite', org.id, { email, role });
      return reply.status(201).send({
        id: invitation.id,
        email,
        role,
        expiresAt: invitation.expiresAt.toISOString(),
      });
    },
  );

  app.delete(
    '/internal/invitations/:id',
    { schema: { params: z.object({ id: z.string().min(1) }) } },
    async (req, reply) => {
      const invitation = await prisma.invitation.findUnique({ where: { id: req.params.id } });
      if (!invitation) throw notFound('Convite não encontrado');
      const me = await requireMembership(prisma, currentUser(req).id, invitation.orgId, MANAGERS);
      assertCanManage(me.role, invitation.role);
      await prisma.invitation.update({
        where: { id: invitation.id },
        data: { revokedAt: new Date() },
      });
      await audit(prisma, req, 'team.invite_revoke', invitation.orgId, { email: invitation.email });
      return reply.status(204).send();
    },
  );

  app.patch(
    '/internal/organizations/:orgId/members/:userId',
    { schema: { params: memberParams, body: memberRoleSchema } },
    async (req) => {
      const me = await requireMembership(prisma, currentUser(req).id, req.params.orgId, MANAGERS);
      const target = await requireMembership(prisma, req.params.userId, req.params.orgId);
      assertCanManage(me.role, target.role, req.body.role);
      if (target.role === 'OWNER' && req.body.role !== 'OWNER')
        await assertNotLastOwner(req.params.orgId, target.userId);
      const updated = await prisma.membership.update({
        where: { id: target.id },
        data: { role: req.body.role },
      });
      await audit(prisma, req, 'team.role_change', req.params.orgId, {
        userId: target.userId,
        from: target.role,
        to: updated.role,
      });
      return { userId: updated.userId, role: updated.role };
    },
  );

  app.delete(
    '/internal/organizations/:orgId/members/:userId',
    { schema: { params: memberParams } },
    async (req, reply) => {
      const user = currentUser(req);
      const leavingSelf = req.params.userId === user.id;
      const me = await requireMembership(
        prisma,
        user.id,
        req.params.orgId,
        leavingSelf ? undefined : MANAGERS,
      );
      const target = leavingSelf
        ? me
        : await requireMembership(prisma, req.params.userId, req.params.orgId);
      if (!leavingSelf) assertCanManage(me.role, target.role);
      if (target.role === 'OWNER') await assertNotLastOwner(req.params.orgId, target.userId);
      await prisma.membership.delete({ where: { id: target.id } });
      await audit(prisma, req, leavingSelf ? 'team.leave' : 'team.remove', req.params.orgId, {
        userId: target.userId,
      });
      return reply.status(204).send();
    },
  );

  // ---- Accepting an invitation (the invitee's side) ----

  const tokenParams = z.object({ token: z.string().min(20).max(100) });

  async function findInvitation(token: string) {
    const invitation = await prisma.invitation.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { org: { select: { id: true, name: true } } },
    });
    if (!invitation) throw notFound('Convite não encontrado');
    return invitation;
  }

  const stateOf = (i: { acceptedAt: Date | null; revokedAt: Date | null; expiresAt: Date }) =>
    i.acceptedAt
      ? 'accepted'
      : i.revokedAt
        ? 'revoked'
        : i.expiresAt <= new Date()
          ? 'expired'
          : 'pending';

  app.get('/internal/invitations/:token', { schema: { params: tokenParams } }, async (req) => {
    const user = currentUser(req);
    const invitation = await findInvitation(req.params.token);
    return {
      orgId: invitation.org.id,
      orgName: invitation.org.name,
      email: invitation.email,
      role: invitation.role,
      state: stateOf(invitation),
      emailMatches: invitation.email === user.email.toLowerCase(),
    };
  });

  app.post(
    '/internal/invitations/:token/accept',
    { schema: { params: tokenParams } },
    async (req) => {
      const user = currentUser(req);
      const invitation = await findInvitation(req.params.token);
      const state = stateOf(invitation);
      if (state !== 'pending')
        throw new HttpError(410, `invitation_${state}`, 'Este convite não é mais válido.');
      if (invitation.email !== user.email.toLowerCase()) {
        throw forbidden(
          `Este convite é para ${invitation.email}. Entre com essa conta para aceitar.`,
        );
      }
      await prisma.$transaction(async (tx) => {
        await tx.membership.upsert({
          where: { userId_orgId: { userId: user.id, orgId: invitation.orgId } },
          update: {},
          create: { userId: user.id, orgId: invitation.orgId, role: invitation.role },
        });
        await tx.invitation.update({
          where: { id: invitation.id },
          data: { acceptedAt: new Date() },
        });
      });
      await audit(prisma, req, 'team.invite_accept', invitation.orgId, { role: invitation.role });
      return { orgId: invitation.orgId, orgName: invitation.org.name, role: invitation.role };
    },
  );
};
