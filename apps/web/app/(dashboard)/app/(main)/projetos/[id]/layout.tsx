import { Badge } from '@fusai/ui/components/badge';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { ProjectTabs } from '@/components/projects/project-tabs';
import { billingModeLabel } from '@/lib/admin-labels';
import type { ProjectDetail } from '@/lib/dashboard-types';
import { serverApi } from '@/lib/session';

export default async function ProjectLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { data: project } = await serverApi<ProjectDetail>(`/internal/projects/${id}`);
  if (!project) notFound();

  return (
    <div className="grid gap-6">
      <div className="grid gap-2">
        <Link href="/app/projetos" className="text-muted-foreground text-sm hover:underline">
          ← Projetos
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-semibold text-2xl tracking-tight">{project.name}</h1>
          <Badge variant="outline">
            {billingModeLabel[project.billingMode] ?? project.billingMode}
          </Badge>
        </div>
        <span className="font-mono text-muted-foreground text-xs">{project.slug}</span>
      </div>
      <ProjectTabs projectId={project.id} />
      {children}
    </div>
  );
}
