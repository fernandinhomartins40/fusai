import type { PrismaClient, Provider } from '@fuseai/db';
import { providerCreateSchema, providerUpdateSchema } from '@fuseai/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { decryptSecret, encryptSecret, maskSecret } from '../../lib/crypto';
import type { Env } from '../../lib/env';
import { conflict, HttpError, notFound } from '../../lib/errors';
import { testProviderConnection } from '../../lib/upstream';
import { audit } from './audit';

type Options = { prisma: PrismaClient; env: Env; encryptionKey: Buffer };

const idParams = z.object({ id: z.string().min(1) });

export const adminProviderRoutes: FastifyPluginAsyncZod<Options> = async (
  app,
  { prisma, env, encryptionKey },
) => {
  const keyOf = (provider: Provider): string | null => {
    if (!provider.apiKeyEnc) return null;
    return decryptSecret(provider.apiKeyEnc, encryptionKey);
  };

  const serialize = (provider: Provider & { _count?: { models: number } }) => {
    let keyMask: string | null = null;
    let keyError = false;
    try {
      const key = keyOf(provider);
      keyMask = key ? maskSecret(key) : null;
    } catch {
      keyError = true;
    }
    return {
      id: provider.id,
      slug: provider.slug,
      name: provider.name,
      baseUrl: provider.baseUrl,
      status: provider.status,
      priority: provider.priority,
      timeoutMs: provider.timeoutMs,
      hasKey: !!provider.apiKeyEnc,
      keyMask,
      keyError,
      modelCount: provider._count?.models ?? 0,
    };
  };

  const assertBaseUrl = (url: string) => {
    if (env.NODE_ENV === 'production' && !url.startsWith('https://')) {
      throw new HttpError(400, 'invalid_request', 'Use uma URL https');
    }
  };

  const find = async (id: string) => {
    const provider = await prisma.provider.findUnique({
      where: { id },
      include: { _count: { select: { models: true } } },
    });
    if (!provider) throw notFound('Provedor não encontrado');
    return provider;
  };

  app.get('/internal/admin/providers', async () => {
    const providers = await prisma.provider.findMany({
      orderBy: [{ priority: 'asc' }, { name: 'asc' }],
      include: { _count: { select: { models: true } } },
    });
    return { providers: providers.map(serialize) };
  });

  app.get('/internal/admin/providers/:id', { schema: { params: idParams } }, async (req) =>
    serialize(await find(req.params.id)),
  );

  app.post(
    '/internal/admin/providers',
    { schema: { body: providerCreateSchema } },
    async (req, reply) => {
      const { apiKey, ...data } = req.body;
      assertBaseUrl(data.baseUrl);
      if (data.status === 'ACTIVE' && !apiKey) {
        throw new HttpError(400, 'invalid_request', 'Cadastre a chave antes de ativar o provedor');
      }
      if (await prisma.provider.findUnique({ where: { slug: data.slug } })) {
        throw conflict('Já existe um provedor com este identificador');
      }
      const provider = await prisma.provider.create({
        data: { ...data, apiKeyEnc: apiKey ? encryptSecret(apiKey, encryptionKey) : '' },
        include: { _count: { select: { models: true } } },
      });
      await audit(prisma, req, 'provider.create', provider.id, {
        slug: provider.slug,
        keySet: !!apiKey,
      });
      return reply.status(201).send(serialize(provider));
    },
  );

  app.patch(
    '/internal/admin/providers/:id',
    { schema: { params: idParams, body: providerUpdateSchema } },
    async (req) => {
      const current = await find(req.params.id);
      const { apiKey, ...data } = req.body;
      if (data.baseUrl) assertBaseUrl(data.baseUrl);
      const willHaveKey = !!apiKey || !!current.apiKeyEnc;
      if (data.status === 'ACTIVE' && !willHaveKey) {
        throw new HttpError(400, 'invalid_request', 'Cadastre a chave antes de ativar o provedor');
      }
      const provider = await prisma.provider.update({
        where: { id: current.id },
        data: { ...data, ...(apiKey ? { apiKeyEnc: encryptSecret(apiKey, encryptionKey) } : {}) },
        include: { _count: { select: { models: true } } },
      });
      await audit(prisma, req, 'provider.update', provider.id, {
        fields: Object.keys(data),
        keyChanged: !!apiKey,
      });
      return serialize(provider);
    },
  );

  app.delete(
    '/internal/admin/providers/:id',
    { schema: { params: idParams } },
    async (req, reply) => {
      const provider = await find(req.params.id);
      if (provider._count.models > 0) {
        throw conflict('Remova ou mova os modelos deste provedor antes de excluí-lo');
      }
      await prisma.provider.delete({ where: { id: provider.id } });
      await audit(prisma, req, 'provider.delete', provider.id, { slug: provider.slug });
      return reply.status(204).send();
    },
  );

  app.post('/internal/admin/providers/:id/test', { schema: { params: idParams } }, async (req) => {
    const provider = await find(req.params.id);
    let key: string | null;
    try {
      key = keyOf(provider);
    } catch {
      throw new HttpError(
        400,
        'invalid_request',
        'Não foi possível decifrar a chave. Cadastre-a novamente.',
      );
    }
    if (!key) throw new HttpError(400, 'invalid_request', 'Cadastre a chave antes de testar');
    const result = await testProviderConnection(
      provider.baseUrl,
      key,
      Math.min(provider.timeoutMs, 30_000),
    );
    await audit(prisma, req, 'provider.test', provider.id, {
      ok: result.ok,
      status: result.status,
    });
    return result;
  });
};
