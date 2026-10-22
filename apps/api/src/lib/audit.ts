import type { Prisma, PrismaClient } from '@fusai/db';
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
    data: {
      actorId: req.user?.id ?? null,
      action,
      target,
      metadata: withImpersonator(metadata, req.user?.impersonatedBy ?? null),
      ip: req.ip,
    },
  });
}

/** During "entrar como cliente" the actor is the customer; keep the real super admin too (S-04). */
function withImpersonator(
  metadata: Prisma.InputJsonValue | undefined,
  impersonatedBy: string | null,
): Prisma.InputJsonValue | undefined {
  if (!impersonatedBy) return metadata;
  if (metadata === undefined) return { impersonatedBy };
  if (typeof metadata === 'object' && metadata !== null && !Array.isArray(metadata)) {
    return { ...(metadata as Prisma.InputJsonObject), impersonatedBy };
  }
  return { value: metadata, impersonatedBy };
}
