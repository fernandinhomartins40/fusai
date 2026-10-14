import type { Model, Prisma, PrismaClient, Provider } from '@fuseai/db';
import { fixedPricesMissing, modelCreateSchema, modelUpdateSchema } from '@fuseai/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { conflict, HttpError, notFound } from '../../lib/errors';
import { pricingSummary } from '../../lib/model-pricing';
import type { SettingsStore } from '../../lib/settings';
import { audit } from './audit';

type Options = { prisma: PrismaClient; settings: SettingsStore };

const idParams = z.object({ id: z.string().min(1) });
const invalid = (message: string) => new HttpError(400, 'invalid_request', message);

type ModelInput = z.output<typeof modelUpdateSchema>;

/** Converts validated input into Prisma data (micros strings -> BigInt). */
function toData(input: ModelInput) {
  const { inputPriceMicrosPerM, outputPriceMicrosPerM, ...rest } = input;
  return {
    ...rest,
    ...(inputPriceMicrosPerM !== undefined && {
      inputPriceMicrosPerM: inputPriceMicrosPerM == null ? null : BigInt(inputPriceMicrosPerM),
    }),
    ...(outputPriceMicrosPerM !== undefined && {
      outputPriceMicrosPerM: outputPriceMicrosPerM == null ? null : BigInt(outputPriceMicrosPerM),
    }),
  };
}

export const adminModelRoutes: FastifyPluginAsyncZod<Options> = async (
  app,
  { prisma, settings },
) => {
  const serialize = async (model: Model & { provider: Provider }) => ({
    id: model.id,
    slug: model.slug,
    displayName: model.displayName,
    description: model.description,
    provider: {
      id: model.provider.id,
      name: model.provider.name,
      slug: model.provider.slug,
      status: model.provider.status,
    },
    upstreamModel: model.upstreamModel,
    contextWindow: model.contextWindow,
    maxOutputTokens: model.maxOutputTokens,
    inputCostUsdPerM: model.inputCostUsdPerM.toFixed(),
    cachedInputCostUsdPerM: model.cachedInputCostUsdPerM?.toFixed() ?? null,
    outputCostUsdPerM: model.outputCostUsdPerM.toFixed(),
    priceMode: model.priceMode,
    markupMultiplier: model.markupMultiplier?.toFixed() ?? null,
    inputPriceMicrosPerM: model.inputPriceMicrosPerM?.toString() ?? null,
    outputPriceMicrosPerM: model.outputPriceMicrosPerM?.toString() ?? null,
    supportsTools: model.supportsTools,
    supportsVision: model.supportsVision,
    supportsReasoning: model.supportsReasoning,
    fallbackModelIds: model.fallbackModelIds,
    active: model.active,
    public: model.public,
    sortOrder: model.sortOrder,
    pricing: pricingSummary(model, await settings.get()),
  });

  const find = async (id: string) => {
    const model = await prisma.model.findUnique({ where: { id }, include: { provider: true } });
    if (!model) throw notFound('Modelo não encontrado');
    return model;
  };

  async function validateRefs(selfId: string | null, input: ModelInput) {
    if (input.providerId && !(await prisma.provider.count({ where: { id: input.providerId } }))) {
      throw invalid('Provedor não encontrado');
    }
    const fallbacks = input.fallbackModelIds ?? [];
    if (selfId && fallbacks.includes(selfId))
      throw invalid('Um modelo não pode ser fallback de si mesmo');
    if (
      fallbacks.length &&
      (await prisma.model.count({ where: { id: { in: fallbacks } } })) !== fallbacks.length
    ) {
      throw invalid('Modelo de fallback não encontrado');
    }
  }

  async function assertSlugFree(slug: string | undefined, selfId: string | null) {
    if (!slug) return;
    const existing = await prisma.model.findUnique({ where: { slug } });
    if (existing && existing.id !== selfId) throw conflict('Já existe um modelo com este slug');
  }

  app.get('/internal/admin/models', async () => {
    const models = await prisma.model.findMany({
      orderBy: [{ sortOrder: 'asc' }, { slug: 'asc' }],
      include: { provider: true },
    });
    return { models: await Promise.all(models.map(serialize)) };
  });

  app.get('/internal/admin/models/:id', { schema: { params: idParams } }, async (req) =>
    serialize(await find(req.params.id)),
  );

  app.post(
    '/internal/admin/models',
    { schema: { body: modelCreateSchema } },
    async (req, reply) => {
      const input = req.body;
      const merged = {
        priceMode: input.priceMode ?? 'AUTO',
        inputPriceMicrosPerM: input.inputPriceMicrosPerM ?? null,
        outputPriceMicrosPerM: input.outputPriceMicrosPerM ?? null,
      };
      if (fixedPricesMissing(merged)) throw invalid('Preço fixo exige preço de entrada e de saída');
      await validateRefs(null, input);
      await assertSlugFree(input.slug, null);

      const model = await prisma.model.create({
        data: {
          active: false,
          fallbackModelIds: [],
          ...toData(input),
        } as Prisma.ModelUncheckedCreateInput,
        include: { provider: true },
      });
      settings.invalidate();
      await audit(prisma, req, 'model.create', model.id, { slug: model.slug });
      return reply.status(201).send(await serialize(model));
    },
  );

  app.patch(
    '/internal/admin/models/:id',
    { schema: { params: idParams, body: modelUpdateSchema } },
    async (req) => {
      const current = await find(req.params.id);
      const input = req.body;
      const merged = {
        priceMode: input.priceMode ?? current.priceMode,
        inputPriceMicrosPerM:
          input.inputPriceMicrosPerM !== undefined
            ? input.inputPriceMicrosPerM
            : current.inputPriceMicrosPerM,
        outputPriceMicrosPerM:
          input.outputPriceMicrosPerM !== undefined
            ? input.outputPriceMicrosPerM
            : current.outputPriceMicrosPerM,
      };
      if (fixedPricesMissing(merged)) throw invalid('Preço fixo exige preço de entrada e de saída');
      await validateRefs(current.id, input);
      await assertSlugFree(input.slug, current.id);

      const model = await prisma.model.update({
        where: { id: current.id },
        data: toData(input) as Prisma.ModelUncheckedUpdateInput,
        include: { provider: true },
      });
      settings.invalidate();
      await audit(prisma, req, 'model.update', model.id, {
        slug: model.slug,
        fields: Object.keys(input),
      });
      return serialize(model);
    },
  );

  app.delete('/internal/admin/models/:id', { schema: { params: idParams } }, async (req, reply) => {
    const model = await find(req.params.id);
    if (await prisma.usageLog.count({ where: { modelId: model.id } })) {
      throw conflict('Este modelo já tem consumo registrado. Desative-o em vez de excluir.');
    }
    await prisma.$transaction(async (tx) => {
      const referencing = await tx.model.findMany({
        where: { fallbackModelIds: { has: model.id } },
      });
      for (const m of referencing) {
        await tx.model.update({
          where: { id: m.id },
          data: { fallbackModelIds: m.fallbackModelIds.filter((id) => id !== model.id) },
        });
      }
      await tx.model.delete({ where: { id: model.id } });
    });
    settings.invalidate();
    await audit(prisma, req, 'model.delete', model.id, { slug: model.slug });
    return reply.status(204).send();
  });
};
