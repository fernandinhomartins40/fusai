import type { Metadata } from 'next';
import { LedgerTable } from '@/components/ledger-table';
import { WalletCards } from '@/components/wallet-cards';
import { getMe, serverApi } from '@/lib/session';
import type { LedgerPage, WalletInfo } from '@/lib/wallet-types';

export const metadata: Metadata = { title: 'Carteira' };

export default async function WalletPage() {
  const me = await getMe();
  const org = me?.organizations[0];
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
          Créditos de {org.name}. A recarga via Pix chega em breve.
        </p>
      </div>
      <WalletCards wallet={wallet} />
      <section className="grid gap-3">
        <h2 className="font-semibold text-lg">Extrato</h2>
        <LedgerTable endpoint={`${base}/ledger`} initial={ledger} />
      </section>
    </div>
  );
}
