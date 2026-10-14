import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { AllowedModelsForm } from '@/components/projects/allowed-models-form';
import type { OrgModel, ProjectDetail } from '@/lib/dashboard-types';
import { serverApi } from '@/lib/session';

export const metadata: Metadata = { title: 'Modelos permitidos' };

export default async function ProjectModelsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { data: project } = await serverApi<ProjectDetail>(`/internal/projects/${id}`);
  if (!project) notFound();
  const { data } = await serverApi<{ models: OrgModel[] }>(
    `/internal/organizations/${project.orgId}/models`,
  );
  return (
    <section className="grid gap-3">
      <div className="grid gap-0.5">
        <h2 className="font-semibold text-lg">Modelos permitidos</h2>
        <p className="text-muted-foreground text-sm">
          Preços da sua organização, em reais por 1 milhão de tokens.
        </p>
      </div>
      <AllowedModelsForm project={project} models={data?.models ?? []} />
    </section>
  );
}
