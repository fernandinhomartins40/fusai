import { Badge } from '@fuseai/ui/components/badge';
import { Card, CardDescription, CardHeader, CardTitle } from '@fuseai/ui/components/card';
import { ChevronRight } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { NewProjectButton } from '@/components/projects/new-project-button';
import { billingModeLabel } from '@/lib/admin-labels';
import { getMe } from '@/lib/session';

export const metadata: Metadata = { title: 'Projetos' };

export default async function ProjectsPage() {
  const me = await getMe();
  const org = me?.organizations[0];
  if (!org) return null;

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="grid gap-1">
          <h1 className="font-semibold text-2xl tracking-tight">Projetos</h1>
          <p className="text-muted-foreground text-sm">
            Cada projeto é um app seu, com chaves e configurações próprias.
          </p>
        </div>
        <NewProjectButton orgId={org.id} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {org.projects.map((p) => (
          <Link key={p.id} href={`/app/projetos/${p.id}`} className="group rounded-2xl">
            <Card className="transition-colors group-hover:border-fuse-pink/40">
              <CardHeader>
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="truncate">{p.name}</CardTitle>
                  <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
                </div>
                <CardDescription className="flex items-center gap-2">
                  <span className="font-mono">{p.slug}</span>
                  <Badge variant="outline">
                    {billingModeLabel[p.billingMode] ?? p.billingMode}
                  </Badge>
                </CardDescription>
              </CardHeader>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
