import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { PackagesPanel } from '@/components/projects/packages-panel';
import type { ProjectDetail } from '@/lib/dashboard-types';
import type { ProjectPackage } from '@/lib/end-user-types';
import { serverApi } from '@/lib/session';

export const metadata: Metadata = { title: 'Pacotes de créditos' };

export default async function ProjectPackagesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [{ data }, { data: project }] = await Promise.all([
    serverApi<{ packages: ProjectPackage[] }>(`/internal/projects/${id}/packages`),
    serverApi<ProjectDetail>(`/internal/projects/${id}`),
  ]);
  if (!data || !project) notFound();
  return (
    <PackagesPanel projectId={id} packages={data.packages} billingMode={project.billingMode} />
  );
}
