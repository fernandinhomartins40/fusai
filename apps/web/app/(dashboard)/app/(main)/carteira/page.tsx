import type { Metadata } from 'next';
import { ExportCsvButton } from '@/components/export-csv-button';
import { LedgerTable } from '@/components/ledger-table';
import { WalletCards } from '@/components/wallet-cards';
import { getCurrentOrg } from '@/lib/current-org';
import { getMe, serverApi } from '@/lib/session';
import type { LedgerPage, WalletInfo } from '@/lib/wallet-types';

export const metadata: Metadata = { title: 'Carteira' };

export default async function WalletPage() {
  const org = await getCurrentOrg(await getMe());
  if (!org) return null;

  const base = `/internal/organizations/${org.id}/wallet`;
  const [{ data: wallet }, { data: ledger }] = await Promise.all([
    serverApi<WalletInfo & { billingType: string }>(base),
    serverApi<LedgerPage>(`${base}/ledger`),
  ]);
  if (!wallet || !ledger) throw new Error('Não foi possível carregar a carteira');

  return (
    <div className="grid gap-6">
      <div className="grid gap-1">
        <h1 className="font-semibold text-2xl tracking-tight">Carteira</h1>
        <p className="text-muted-foreground text-sm">
          Créditos de {org.name}. A recarga via Pix chega na próxima etapa.
        </p>
      </div>
      <WalletCards wallet={wallet} />
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
