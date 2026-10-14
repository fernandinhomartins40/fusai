'use client';

import { formatBRL } from '@fuseai/shared';
import { Badge } from '@fuseai/ui/components/badge';
import { Button } from '@fuseai/ui/components/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@fuseai/ui/components/table';
import { Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { apiFetch } from '@/lib/api';
import { dateTimeBR } from '@/lib/format';
import { type LedgerPage, ledgerTypeLabel } from '@/lib/wallet-types';

/** Wallet statement with cursor pagination ("Carregar mais"). `endpoint` returns a LedgerPage. */
export function LedgerTable({ endpoint, initial }: { endpoint: string; initial: LedgerPage }) {
  const [items, setItems] = useState(initial.items);
  const [cursor, setCursor] = useState(initial.nextCursor);
  const [loading, setLoading] = useState(false);

  // A server refresh (new top-up, adjustment) brings a new first page: start over from it.
  useEffect(() => {
    setItems(initial.items);
    setCursor(initial.nextCursor);
  }, [initial]);

  async function loadMore() {
    if (!cursor) return;
    setLoading(true);
    try {
      const page = await apiFetch<LedgerPage>(`${endpoint}?cursor=${encodeURIComponent(cursor)}`);
      setItems((prev) => [...prev, ...page.items]);
      setCursor(page.nextCursor);
    } catch {
      toast.error('Não foi possível carregar mais lançamentos.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="grid gap-3">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Data</TableHead>
            <TableHead>Tipo</TableHead>
            <TableHead>Descrição</TableHead>
            <TableHead className="text-right">Valor</TableHead>
            <TableHead className="text-right">Saldo</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.length === 0 ? (
            <TableRow>
              <TableCell colSpan={5} className="py-10 text-center text-muted-foreground">
                Nenhum lançamento ainda.
              </TableCell>
            </TableRow>
          ) : (
            items.map((e) => {
              const amount = BigInt(e.amountMicros);
              return (
                <TableRow key={e.id}>
                  <TableCell className="text-muted-foreground tabular-nums">
                    {dateTimeBR(e.createdAt)}
                  </TableCell>
                  <TableCell>
                    <Badge variant={amount < 0n ? 'secondary' : 'success'}>
                      {ledgerTypeLabel[e.type]}
                    </Badge>
                  </TableCell>
                  <TableCell className="max-w-72 truncate whitespace-normal">
                    {e.description ?? '—'}
                  </TableCell>
                  <TableCell
                    className={`text-right font-medium tabular-nums ${amount < 0n ? '' : 'text-success'}`}
                  >
                    {amount > 0n ? '+' : ''}
                    {formatBRL(amount, { precise: amount !== 0n && amount % 10_000n !== 0n })}
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground tabular-nums">
                    {formatBRL(BigInt(e.balanceAfter))}
                  </TableCell>
                </TableRow>
              );
            })
          )}
        </TableBody>
      </Table>
      {cursor ? (
        <Button
          variant="outline"
          onClick={loadMore}
          disabled={loading}
          className="justify-self-center"
        >
          {loading ? <Loader2 className="animate-spin" /> : null}
          Carregar mais
        </Button>
      ) : null}
    </div>
  );
}
