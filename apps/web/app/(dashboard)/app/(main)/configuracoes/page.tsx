import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@fusai/ui/components/card';
import type { Metadata } from 'next';
import { OrgSettingsForm } from '@/components/org-settings-form';
import { PrivacySection } from '@/components/privacy-section';
import { SecuritySection } from '@/components/security/security-section';
import { billingTypeLabel } from '@/lib/admin-labels';
import { getCurrentOrg } from '@/lib/current-org';
import type { OrgSettings } from '@/lib/dashboard-types';
import { getMe, serverApi } from '@/lib/session';

export const metadata: Metadata = { title: 'Configurações' };

export default async function SettingsPage() {
  const org = await getCurrentOrg(await getMe());
  if (!org) return null;
  const { data } = await serverApi<OrgSettings>(`/internal/organizations/${org.id}`);
  if (!data) throw new Error('Não foi possível carregar as configurações');

  return (
    <div className="grid gap-6">
      <div className="grid gap-1">
        <h1 className="font-semibold text-2xl tracking-tight">Configurações</h1>
        <p className="text-muted-foreground text-sm">
          {data.name} · <span className="font-mono">{data.slug}</span> ·{' '}
          {billingTypeLabel[data.billingType]}
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Organização</CardTitle>
          <CardDescription>Dados de cobrança e alertas de saldo.</CardDescription>
        </CardHeader>
        <CardContent>
          <OrgSettingsForm org={data} />
        </CardContent>
      </Card>
      <SecuritySection />
      <PrivacySection />
    </div>
  );
}
