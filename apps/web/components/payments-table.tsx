import { centsToMicros, formatBRL } from '@fusai/shared';
import { Badge } from '@fusai/ui/components/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@fusai/ui/components/table';
import type { ReactNode } from 'react';
import { dateTimeBR } from '@/lib/format';
import { type PaymentInfo, paymentStatusLabel } from '@/lib/payment-types';

export function PaymentsTable({
  items,
  extraColumn,
}: {
  items: (PaymentInfo & { org?: { name: string } })[];
  extraColumn?: { header: string; cell: (p: PaymentInfo) => ReactNode };
}) {
  const showOrg = items.some((p) => p.org);
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Data</TableHead>
          {showOrg ? <TableHead>Cliente</TableHead> : null}
          <TableHead className="text-right">Valor pago</TableHead>
          <TableHead className="text-right">Créditos</TableHead>
          <TableHead>Status</TableHead>
          {extraColumn ? <TableHead className="text-right">{extraColumn.header}</TableHead> : null}
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.length === 0 ? (
          <TableRow>
            <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
              Nenhuma recarga ainda.
            </TableCell>
          </TableRow>
        ) : (
          items.map((p) => {
            const s = paymentStatusLabel[p.status];
            return (
              <TableRow key={p.id}>
                <TableCell className="text-muted-foreground tabular-nums">
                  {dateTimeBR(p.createdAt)}
                </TableCell>
                {showOrg ? <TableCell>{p.org?.name}</TableCell> : null}
                <TableCell className="text-right tabular-nums">
                  {formatBRL(centsToMicros(p.amountCents))}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatBRL(BigInt(p.creditMicros))}
                </TableCell>
                <TableCell>
                  <Badge variant={s.variant}>{s.label}</Badge>
                </TableCell>
                {extraColumn ? (
                  <TableCell className="text-right">{extraColumn.cell(p)}</TableCell>
                ) : null}
              </TableRow>
            );
          })
        )}
      </TableBody>
    </Table>
  );
}
