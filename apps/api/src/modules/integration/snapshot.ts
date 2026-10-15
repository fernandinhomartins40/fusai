import type { Organization, PrismaClient, Project } from '@fuseai/db';
import type { ProjectSnapshot } from '@fuseai/docs';
import type { SettingsStore } from '../../lib/settings';
import type { CatalogStore } from '../gateway/catalog';
import { listModelsFor } from '../gateway/queries';

/** Everything the integration guide / FUSEAI.md need about a project. Never secrets. */
export async function projectSnapshot(
  prisma: PrismaClient,
  catalog: CatalogStore,
  settings: SettingsStore,
  project: Project,
  org: Organization,
): Promise<ProjectSnapshot> {
  const [models, packages, { byId }] = await Promise.all([
    listModelsFor({ org, project, env: 'LIVE' }, catalog, settings),
    prisma.creditPackage.findMany({
      where: { projectId: project.id, active: true },
      orderBy: [{ sortOrder: 'asc' }, { priceCents: 'asc' }],
    }),
    catalog.get(),
  ]);
  return {
    name: project.name,
    billingMode: project.billingMode,
    allowedOrigins: project.allowedOrigins,
    webhookUrl: project.webhookUrl,
    freeCreditMicros: project.freeCreditMicros.toString(),
    defaultModel: project.defaultModelId
      ? (byId.get(project.defaultModelId)?.model.slug ?? null)
      : null,
    models: models.map((m) => ({
      id: m.id,
      name: m.name,
      input: m.pricing.input,
      output: m.pricing.output,
    })),
    packages: packages.map((p) => ({
      id: p.id,
      name: p.name,
      priceCents: p.priceCents,
      creditMicros: p.creditMicros.toString(),
      bonusMicros: p.bonusMicros.toString(),
    })),
  };
}
