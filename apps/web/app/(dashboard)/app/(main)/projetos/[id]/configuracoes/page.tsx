import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@fusai/ui/components/card';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ProjectSettingsForm } from '@/components/projects/project-settings-form';
import { WebhookSecret } from '@/components/projects/webhook-secret';
import { getCurrentOrg } from '@/lib/current-org';
import type { ProjectDetail } from '@/lib/dashboard-types';
import { getMe, serverApi } from '@/lib/session';

export const metadata: Metadata = { title: 'Configurações do projeto' };

export default async function ProjectSettingsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [{ data: project }, me] = await Promise.all([
    serverApi<ProjectDetail & { hasWebhookSecret: boolean }>(`/internal/projects/${id}`),
    getMe(),
  ]);
  if (!project) notFound();
  const org = me?.organizations.find((o) => o.id === project.orgId) ?? (await getCurrentOrg(me));
  const role = org?.role ?? 'DEVELOPER';
  const canEdit = role !== 'BILLING';

  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Projeto</CardTitle>
          <CardDescription>Cobrança, CORS, bônus de boas-vindas e webhook.</CardDescription>
        </CardHeader>
        <CardContent>
          {canEdit ? (
            <ProjectSettingsForm
              project={project}
              canChangeBilling={role === 'OWNER' || role === 'ADMIN'}
            />
          ) : (
            <p className="text-muted-foreground text-sm">
              Seu papel (Financeiro) não altera configurações de projeto.
            </p>
          )}
        </CardContent>
      </Card>
      {canEdit ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Segredo do webhook</CardTitle>
            <CardDescription>
              Usado para assinar as notificações enviadas ao seu servidor.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <WebhookSecret projectId={project.id} hasSecret={project.hasWebhookSecret} />
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
