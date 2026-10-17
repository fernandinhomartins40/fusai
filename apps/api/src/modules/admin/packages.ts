import type { PrismaClient } from '@fusai/db';
import { projectPackageSchema, projectPackageUpdateSchema } from '@fusai/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { audit } from '../../lib/audit';
import { HttpError, notFound } from '../../lib/errors';
import { serializePackage } from '../dashboard/end-users';

const idParams = z.object({ id: z.string().min(1) });
const MAX_PACKAGES = 20;

/** Global top-up packages (projectId = null): what customers see in "Adicionar créditos". */
export const adminPackageRoutes: FastifyPluginAsyncZod<{ prisma: PrismaClient }> = async (
  app,
  { prisma },
) => {
  app.get('/internal/admin/packages', async () => {
    const packages = await prisma.creditPackage.findMany({
      where: { projectId: null },
      orderBy: [{ sortOrder: 'asc' }, { priceCents: 'asc' }],
    });
    return { packages: packages.map(serializePackage) };
  });

  app.post(
    '/internal/admin/packages',
    { schema: { body: projectPackageSchema } },
    async (req, reply) => {
      if ((await prisma.creditPackage.count({ where: { projectId: null } })) >= MAX_PACKAGES) {
        throw new HttpError(409, 'too_many_packages', `Máximo de ${MAX_PACKAGES} pacotes.`);
      }
      const { creditMicros, bonusMicros, ...rest } = req.body;
      const pkg = await prisma.creditPackage.create({
        data: {
          ...rest,
          projectId: null,
          creditMicros: BigInt(creditMicros),
          bonusMicros: BigInt(bonusMicros),
        },
      });
      await audit(prisma, req, 'package.create', pkg.id, { global: true });
      return reply.status(201).send(serializePackage(pkg));
    },
  );

  app.patch(
    '/internal/admin/packages/:id',
    { schema: { params: idParams, body: projectPackageUpdateSchema } },
    async (req) => {
      const { creditMicros, bonusMicros, ...rest } = req.body;
      const res = await prisma.creditPackage.updateMany({
        where: { id: req.params.id, projectId: null },
        data: {
          ...rest,
          ...(creditMicros !== undefined ? { creditMicros: BigInt(creditMicros) } : {}),
          ...(bonusMicros !== undefined ? { bonusMicros: BigInt(bonusMicros) } : {}),
        },
      });
      if (res.count === 0) throw notFound('Pacote não encontrado');
      await audit(prisma, req, 'package.update', req.params.id, {
        global: true,
        fields: Object.keys(req.body),
      });
      return serializePackage(
        await prisma.creditPackage.findUniqueOrThrow({ where: { id: req.params.id } }),
      );
    },
  );

  // A package that was ever bought is deactivated (payments keep its id), not deleted.
  app.delete('/internal/admin/packages/:id', { schema: { params: idParams } }, async (req) => {
    const pkg = await prisma.creditPackage.findFirst({
      where: { id: req.params.id, projectId: null },
    });
    if (!pkg) throw notFound('Pacote não encontrado');
    const used = await prisma.payment.count({ where: { packageId: pkg.id } });
    if (used > 0) {
      await prisma.creditPackage.update({ where: { id: pkg.id }, data: { active: false } });
    } else {
      await prisma.creditPackage.delete({ where: { id: pkg.id } });
    }
    await audit(prisma, req, 'package.delete', pkg.id, { global: true, deactivated: used > 0 });
    return { deleted: used === 0, deactivated: used > 0 };
  });
};
