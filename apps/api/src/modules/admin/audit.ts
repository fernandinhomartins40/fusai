import type { Prisma, PrismaClient } from '@fuseai/db';
import type { FastifyRequest } from 'fastify';

/** Records an administrative action. Never pass secrets in `metadata`. */
export async function audit(
  prisma: PrismaClient,
  req: FastifyRequest,
  action: string,
  target: string | null,
  metadata?: Prisma.InputJsonValue,
) {
  await prisma.auditLog.create({
    data: { actorId: req.user?.id ?? null, action, target, metadata, ip: req.ip },
  });
}
