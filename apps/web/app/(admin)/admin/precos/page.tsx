import { Card, CardContent } from '@fusai/ui/components/card';
import type { Metadata } from 'next';
import { PageHeader } from '@/components/admin/page-header';
import { SettingsForm } from '@/components/admin/settings-form';
import type { AdminFx, AdminSettings } from '@/lib/admin-types';
import { dateTimeBR } from '@/lib/format';
import { serverApi } from '@/lib/session';

export const metadata: Metadata = { title: 'Preços globais' };

export default async function GlobalPricesPage() {
  const [{ data: settings }, { data: fx }] = await Promise.all([
    serverApi<AdminSettings>('/internal/admin/settings'),
    serverApi<AdminFx>('/internal/admin/fx'),
  ]);
  if (!settings) throw new Error('Não foi possível carregar as configurações');

  return (
    <div className="mx-auto grid max-w-3xl gap-6">
      <PageHeader
        title="Preços globais"
        description="Mudanças no câmbio e na margem valem na hora para todos os modelos com preço automático."
      />
      {fx ? <FxStatus fx={fx} /> : null}
      <Card>
        <CardContent className="pt-6">
          <SettingsForm settings={settings} />
        </CardContent>
      </Card>
    </div>
  );
}

const comma = (v: string) => v.replace('.', ',');

function FxStatus({ fx }: { fx: AdminFx }) {
  const run = fx.lastRun;
  return (
    <Card>
      <CardContent className="grid gap-1 pt-6 text-sm">
        <p className="font-medium">
          Câmbio em uso: R$ {comma(fx.rate)}{' '}
          <span className="text-muted-foreground font-normal">
            {fx.auto ? '(automático, PTAX do Banco Central)' : '(fixado à mão)'}
          </span>
        </p>
        {fx.rateUpdatedAt ? (
          <p className="text-muted-foreground">Alterado em {dateTimeBR(fx.rateUpdatedAt)}.</p>
        ) : null}
        {run?.status === 'rejected' ? (
          <p className="text-warning-foreground">
            Em {dateTimeBR(run.at)} a PTAX (R$ {comma(run.metadata?.quoted ?? '?')}) variou mais de
            10% e não foi aplicada. Confira e salve o valor certo abaixo.
          </p>
        ) : run ? (
          <p className="text-muted-foreground">
            Última atualização automática: {dateTimeBR(run.at)}.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
