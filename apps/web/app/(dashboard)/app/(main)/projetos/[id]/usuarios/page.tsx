import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { FormAlert } from '@/components/form-field';
import { AppUsersPanel } from '@/components/projects/app-users-panel';
import type { ProjectDetail } from '@/lib/dashboard-types';
import type { AppUserPage } from '@/lib/end-user-types';
import { getMe, serverApi } from '@/lib/session';

export const metadata: Metadata = { title: 'Usuários finais' };

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ q?: string }> };

export default async function ProjectAppUsersPage({ params, searchParams }: Props) {
  const { id } = await params;
  const q = ((await searchParams).q ?? '').trim().slice(0, 120);
  const query = q ? `?${new URLSearchParams({ q })}` : '';
  const [{ data }, { data: project }, me] = await Promise.all([
    serverApi<AppUserPage>(`/internal/projects/${id}/app-users${query}`),
    serverApi<ProjectDetail>(`/internal/projects/${id}`),
    getMe(),
  ]);
  if (!data || !project) notFound();
  const role = me?.organizations.find((o) => o.id === project.orgId)?.role;
  return (
    <div className="grid gap-4">
      {project.billingMode === 'ORG_WALLET' ? (
        <FormAlert tone="info">
          Este projeto está em “Carteira da organização”: o consumo sai dos créditos da sua conta e
          os usuários finais não têm saldo próprio. Mude o modo de cobrança em Configurações para
          vender créditos a eles.
        </FormAlert>
      ) : null}
      <AppUsersPanel
        projectId={id}
        query={q}
        initial={data}
        canAdjust={role === 'OWNER' || role === 'ADMIN'}
      />
    </div>
  );
}
