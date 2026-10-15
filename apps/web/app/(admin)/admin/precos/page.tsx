import { Card, CardContent } from '@fusai/ui/components/card';
import type { Metadata } from 'next';
import { PageHeader } from '@/components/admin/page-header';
import { SettingsForm } from '@/components/admin/settings-form';
import type { AdminSettings } from '@/lib/admin-types';
import { serverApi } from '@/lib/session';

export const metadata: Metadata = { title: 'Preços globais' };

export default async function GlobalPricesPage() {
  const { data: settings } = await serverApi<AdminSettings>('/internal/admin/settings');
  if (!settings) throw new Error('Não foi possível carregar as configurações');

  return (
    <div className="mx-auto grid max-w-3xl gap-6">
      <PageHeader
        title="Preços globais"
        description="Mudanças no câmbio e na margem valem na hora para todos os modelos com preço automático."
      />
      <Card>
        <CardContent className="pt-6">
          <SettingsForm settings={settings} />
        </CardContent>
      </Card>
    </div>
  );
}
