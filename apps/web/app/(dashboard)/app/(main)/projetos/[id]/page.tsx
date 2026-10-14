import { Badge } from '@fuseai/ui/components/badge';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ApiKeysPanel } from '@/components/api-keys/api-keys-panel';
import { billingModeLabel } from '@/lib/admin-labels';
import type { ApiKeyInfo } from '@/lib/api-key-types';
import { API_URL } from '@/lib/config';
import { serverApi } from '@/lib/session';

export const metadata: Metadata = { title: 'Projeto' };

type ProjectInfo = { id: string; name: string; slug: string; billingMode: string };

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [{ data: project }, { data: keys }] = await Promise.all([
    serverApi<ProjectInfo>(`/internal/projects/${id}`),
    serverApi<{ keys: ApiKeyInfo[] }>(`/internal/projects/${id}/api-keys`),
  ]);
  if (!project || !keys) notFound();

  return (
    <div className="grid gap-8">
      <div className="grid gap-2">
        <Link href="/app/projetos" className="text-muted-foreground text-sm hover:underline">
          ← Projetos
        </Link>
        <h1 className="font-semibold text-2xl tracking-tight">{project.name}</h1>
        <div className="flex flex-wrap items-center gap-2 text-muted-foreground text-sm">
          <span className="font-mono">{project.slug}</span>
          <Badge variant="outline">
            {billingModeLabel[project.billingMode] ?? project.billingMode}
          </Badge>
          <span>
            · Base URL <code className="font-mono text-foreground">{API_URL}/v1</code>
          </span>
        </div>
      </div>
      <ApiKeysPanel projectId={project.id} keys={keys.keys} />
    </div>
  );
}
