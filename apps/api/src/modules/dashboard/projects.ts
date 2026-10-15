import { randomBytes } from 'node:crypto';
import type { PrismaClient, Project } from '@fuseai/db';
import { microsToBrl, orgUpdateSchema, projectUpdateSchema } from '@fuseai/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { audit } from '../../lib/audit';
import { decryptSecret, encryptSecret } from '../../lib/crypto';
import type { Env } from '../../lib/env';
import { HttpError, notFound } from '../../lib/errors';
import { priceModel } from '../../lib/model-pricing';
import { currentUser } from '../../lib/session';
import type { SettingsStore } from '../../lib/settings';
import { type CatalogStore, isServable } from '../gateway/catalog';
import { requireMembership } from './membership';

type Options = {
  prisma: PrismaClient;
  env: Env;
  settings: SettingsStore;
  catalog: CatalogStore;
  encryptionKey: Buffer;
};

const EDITORS = ['OWNER', 'ADMIN', 'DEVELOPER'] as const;
const MANAGERS = ['OWNER', 'ADMIN'] as const;
const invalid = (message: string) => new HttpError(400, 'invalid_request', message);
const newWebhookSecret = () => `whsec_${randomBytes(32).toString('base64url')}`;

export function serializeProject(p: Project) {
  return {
    id: p.id,
    orgId: p.orgId,
    name: p.name,
    slug: p.slug,
    billingMode: p.billingMode,
    defaultModelId: p.defaultModelId,
    allowedModelIds: p.allowedModelIds,
    allowedOrigins: p.allowedOrigins,
    webhookUrl: p.webhookUrl,
    hasWebhookSecret: !!p.webhookSecret,
    freeCreditMicros: p.freeCreditMicros.toString(),
    createdAt: p.createdAt.toISOString(),
  };
}

/** Project settings, allowed models, webhook secret, and organization settings. */
export const dashboardProjectRoutes: FastifyPluginAsyncZod<Options> = async (app, opts) => {
  const { prisma, env, settings, catalog, encryptionKey } = opts;

  async function projectFor(
    userId: string,
    projectId: string,
    roles?: readonly ('OWNER' | 'ADMIN' | 'DEVELOPER')[],
  ) {
    const project = await prisma.project.findUnique({ where: { id: projectId } });
    if (!project) throw notFound('Projeto não encontrado');
    const membership = await requireMembership(prisma, userId, project.orgId, roles);
    return { project, membership };
  }

  const projectParams = z.object({ projectId: z.string().min(1) });
  const orgParams = z.object({ orgId: z.string().min(1) });

  // Models the organization can use, with its own prices (markup override included).
  app.get(
    '/internal/organizations/:orgId/models',
    { schema: { params: orgParams } },
    async (req) => {
      await requireMembership(prisma, currentUser(req).id, req.params.orgId);
      const org = await prisma.organization.findUniqueOrThrow({ where: { id: req.params.orgId } });
      const [{ bySlug }, s] = await Promise.all([catalog.get(), settings.get()]);
      const markup = org.markupOverride?.toFixed() ?? null;
      return {
        models: [...bySlug.values()]
          .filter(isServable)
          .sort(
            (a, b) =>
              a.model.sortOrder - b.model.sortOrder || a.model.slug.localeCompare(b.model.slug),
          )
          .map((e) => {
            const p = priceModel(e.model, s, markup);
            return {
              id: e.model.id,
              slug: e.model.slug,
              name: e.model.displayName,
              contextWindow: e.model.contextWindow,
              inputPerM: p.inputPerM.toString(),
              outputPerM: p.outputPerM.toString(),
            };
          }),
      };
    },
  );

  app.patch(
    '/internal/projects/:projectId',
    { schema: { params: projectParams, body: projectUpdateSchema } },
    async (req) => {
      const user = currentUser(req);
      const { project, membership } = await projectFor(user.id, req.params.projectId, EDITORS);
      const body = req.body;
      if (
        body.billingMode &&
        body.billingMode !== project.billingMode &&
        !MANAGERS.includes(membership.role as never)
      ) {
        throw new HttpError(403, 'forbidden', 'Só donos e admins mudam o modo de cobrança');
      }
      if (
        body.webhookUrl &&
        env.NODE_ENV === 'production' &&
        !body.webhookUrl.startsWith('https://')
      ) {
        throw invalid('O webhook precisa usar https');
      }
      const allowed = body.allowedModelIds ?? project.allowedModelIds;
      const toCheck = [
        ...(body.allowedModelIds ?? []),
        ...(body.defaultModelId ? [body.defaultModelId] : []),
      ];
      if (toCheck.length) {
        const found = await prisma.model.count({
          where: { id: { in: [...new Set(toCheck)] }, active: true },
        });
        if (found !== new Set(toCheck).size) throw invalid('Modelo inexistente ou inativo');
      }
      const defaultModelId =
        body.defaultModelId !== undefined ? body.defaultModelId : project.defaultModelId;
      if (defaultModelId && allowed.length && !allowed.includes(defaultModelId)) {
        throw invalid('O modelo padrão precisa estar entre os modelos permitidos');
      }
      const { freeCreditMicros, ...rest } = body;
      const updated = await prisma.project.update({
        where: { id: project.id },
        data: {
          ...rest,
          ...(body.allowedOrigins ? { allowedOrigins: [...new Set(body.allowedOrigins)] } : {}),
          ...(freeCreditMicros !== undefined ? { freeCreditMicros: BigInt(freeCreditMicros) } : {}),
          // Deliveries are always signed: the first webhook URL gets a secret automatically.
          ...(body.webhookUrl && !project.webhookSecret
            ? { webhookSecret: encryptSecret(newWebhookSecret(), encryptionKey) }
            : {}),
        },
      });
      await audit(prisma, req, 'project.update', project.id, { fields: Object.keys(body) });
      return serializeProject(updated);
    },
  );

  app.get(
    '/internal/projects/:projectId/webhook-secret',
    { schema: { params: projectParams } },
    async (req) => {
      const { project } = await projectFor(currentUser(req).id, req.params.projectId, EDITORS);
      if (!project.webhookSecret) return { secret: null };
      return { secret: decryptSecret(project.webhookSecret, encryptionKey) };
    },
  );

  app.post(
    '/internal/projects/:projectId/webhook-secret/rotate',
    { schema: { params: projectParams } },
    async (req) => {
      const { project } = await projectFor(currentUser(req).id, req.params.projectId, EDITORS);
      const secret = newWebhookSecret();
      await prisma.project.update({
        where: { id: project.id },
        data: { webhookSecret: encryptSecret(secret, encryptionKey) },
      });
      await audit(prisma, req, 'webhook.secret_rotate', project.id);
      return { secret };
    },
  );

  // ---- Organization settings ----

  app.get('/internal/organizations/:orgId', { schema: { params: orgParams } }, async (req) => {
    const membership = await requireMembership(prisma, currentUser(req).id, req.params.orgId);
    const org = await prisma.organization.findUniqueOrThrow({ where: { id: req.params.orgId } });
    const s = await settings.get();
    return {
      id: org.id,
      name: org.name,
      slug: org.slug,
      document: org.document,
      phone: org.phone,
      status: org.status,
      billingType: org.billingType,
      role: membership.role,
      lowBalanceAlertMicros: org.lowBalanceAlertMicros?.toString() ?? null,
      defaultLowBalanceMicros: s.low_balance_threshold_micros,
      suggestedTopupCents: org.suggestedTopupCents,
      minTopupCents: s.min_topup_cents,
      defaultLowBalance: microsToBrl(BigInt(s.low_balance_threshold_micros)),
    };
  });

  app.patch(
    '/internal/organizations/:orgId',
    { schema: { params: orgParams, body: orgUpdateSchema } },
    async (req) => {
      await requireMembership(prisma, currentUser(req).id, req.params.orgId, MANAGERS);
      const org = await prisma.organization.findUniqueOrThrow({ where: { id: req.params.orgId } });
      const { lowBalanceAlertMicros, ...rest } = req.body;
      const updated = await prisma.organization.update({
        where: { id: org.id },
        data: {
          ...rest,
          ...(lowBalanceAlertMicros !== undefined
            ? {
                lowBalanceAlertMicros:
                  lowBalanceAlertMicros == null ? null : BigInt(lowBalanceAlertMicros),
              }
            : {}),
          // The Asaas customer is tied to the CPF/CNPJ: a new document needs a new customer.
          ...(rest.document && rest.document !== org.document ? { asaasCustomerId: null } : {}),
        },
      });
      await audit(prisma, req, 'org.update', org.id, { fields: Object.keys(req.body) });
      return { id: updated.id, name: updated.name };
    },
  );
};
