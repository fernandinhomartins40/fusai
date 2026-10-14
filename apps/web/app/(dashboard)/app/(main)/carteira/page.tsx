import type { Metadata } from 'next';
import { ExportCsvButton } from '@/components/export-csv-button';
import { LedgerTable } from '@/components/ledger-table';
import { PaymentsTable } from '@/components/payments-table';
import { TopupDialog } from '@/components/topup/topup-dialog';
import { WalletCards } from '@/components/wallet-cards';
import { getCurrentOrg } from '@/lib/current-org';
import type { PaymentInfo, TopupOptions } from '@/lib/payment-types';
import { getMe, serverApi } from '@/lib/session';
import type { LedgerPage, WalletInfo } from '@/lib/wallet-types';

export const metadata: Metadata = { title: 'Carteira' };

type Props = { searchParams: Promise<{ recarga?: string }> };

export default async function WalletPage({ searchParams }: Props) {
  const org = await getCurrentOrg(await getMe());
  if (!org) return null;
  const { recarga } = await searchParams;

  const base = `/internal/organizations/${org.id}/wallet`;
  const [{ data: wallet }, { data: ledger }, { data: options }, { data: payments }] =
    await Promise.all([
      serverApi<WalletInfo & { billingType: string }>(base),
      serverApi<LedgerPage>(`${base}/ledger`),
      serverApi<TopupOptions>(`/internal/organizations/${org.id}/topup-options`),
      serverApi<{ items: PaymentInfo[] }>(`/internal/organizations/${org.id}/payments`),
    ]);
  if (!wallet || !ledger || !options) throw new Error('Não foi possível carregar a carteira');
  const internal = wallet.billingType === 'INTERNAL';

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="grid gap-1">
          <h1 className="font-semibold text-2xl tracking-tight">Carteira</h1>
          <p className="text-muted-foreground text-sm">
            Créditos de {org.name}.{' '}
            {internal ? 'Organização interna, sem cobrança.' : 'Recarga instantânea via Pix.'}
          </p>
        </div>
        {internal ? null : (
          <div className="flex flex-wrap items-center gap-2">
            <TopupDialog orgId={org.id} options={options} autoOpen={recarga === '1'} />
          </div>
        )}
      </div>
      <WalletCards wallet={wallet} />
      {internal ? null : (
        <section className="grid gap-3">
          <h2 className="font-semibold text-lg">Recargas</h2>
          <PaymentsTable items={payments?.items ?? []} />
        </section>
      )}
      <section className="grid gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold text-lg">Extrato</h2>
          <ExportCsvButton path={`${base}/ledger.csv`} label="Exportar extrato (CSV)" />
        </div>
        <LedgerTable endpoint={`${base}/ledger`} initial={ledger} />
      </section>
    </div>
  );
}
