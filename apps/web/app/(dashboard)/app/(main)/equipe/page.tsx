import type { Metadata } from 'next';
import { TeamPanel } from '@/components/team/team-panel';
import { getCurrentOrg } from '@/lib/current-org';
import type { TeamData } from '@/lib/dashboard-types';
import { getMe, serverApi } from '@/lib/session';

export const metadata: Metadata = { title: 'Equipe' };

export default async function TeamPage() {
  const me = await getMe();
  const org = await getCurrentOrg(me);
  if (!me || !org) return null;
  const { data } = await serverApi<TeamData>(`/internal/organizations/${org.id}/members`);
  if (!data) throw new Error('Não foi possível carregar a equipe');

  return (
    <div className="grid gap-6">
      <div className="grid gap-1">
        <h1 className="font-semibold text-2xl tracking-tight">Equipe</h1>
        <p className="text-muted-foreground text-sm">Quem acessa {org.name} e com qual papel.</p>
      </div>
      <TeamPanel orgId={org.id} data={data} myUserId={me.user.id} />
    </div>
  );
}
