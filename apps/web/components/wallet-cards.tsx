import { formatBRL } from '@fuseai/shared';
import { Card, CardDescription, CardHeader, CardTitle } from '@fuseai/ui/components/card';
import type { WalletInfo } from '@/lib/wallet-types';

/** Balance / reserved / available, shared by the customer wallet and the admin customer page. */
export function WalletCards({ wallet }: { wallet: WalletInfo }) {
  const available = BigInt(wallet.availableMicros);
  const cards = [
    { label: 'Disponível', value: available, strong: true },
    { label: 'Saldo', value: BigInt(wallet.balanceMicros) },
    { label: 'Reservado em requisições', value: BigInt(wallet.reservedMicros) },
  ];
  return (
    <div className="grid gap-4 sm:grid-cols-3">
      {cards.map((c) => (
        <Card key={c.label}>
          <CardHeader>
            <CardDescription>{c.label}</CardDescription>
            <CardTitle
              className={`tabular-nums ${c.strong ? 'text-3xl' : 'text-2xl'} ${c.value < 0n ? 'text-destructive' : ''}`}
            >
              {formatBRL(c.value)}
            </CardTitle>
          </CardHeader>
        </Card>
      ))}
    </div>
  );
}
