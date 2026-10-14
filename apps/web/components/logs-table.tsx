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
import type { LogItem } from '@/lib/dashboard-types';
import { dateTimeBR } from '@/lib/format';
import { statusLabel } from '@/lib/log-status';

const money = (m: string) =>
  formatBRL(BigInt(m), { precise: BigInt(m) > 0n && BigInt(m) < 10_000n });
const ms = (v: number | null) =>
  v == null ? '—' : v >= 1000 ? `${(v / 1000).toFixed(1).replace('.', ',')} s` : `${v} ms`;

/** Recent gateway requests. Message content is never stored (privacy by default). */
export function LogsTable({
  endpoint,
  initial,
}: {
  endpoint: string;
  initial: { items: LogItem[]; nextCursor: string | null };
}) {
  const [items, setItems] = useState(initial.items);
  const [cursor, setCursor] = useState(initial.nextCursor);
  const [loading, setLoading] = useState(false);

  // New filters re-render the server page with a new `initial`.
  useEffect(() => {
    setItems(initial.items);
    setCursor(initial.nextCursor);
  }, [initial]);

  async function loadMore() {
    if (!cursor) return;
    setLoading(true);
    try {
      const sep = endpoint.includes('?') ? '&' : '?';
      const page = await apiFetch<{ items: LogItem[]; nextCursor: string | null }>(
        `${endpoint}${sep}cursor=${encodeURIComponent(cursor)}`,
      );
      setItems((prev) => [...prev, ...page.items]);
      setCursor(page.nextCursor);
    } catch {
      toast.error('Não foi possível carregar mais.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="grid gap-3">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Quando</TableHead>
            <TableHead>Modelo</TableHead>
            <TableHead>Projeto · chave</TableHead>
            <TableHead className="text-right">Tokens (entrada/saída)</TableHead>
            <TableHead className="text-right">Custo</TableHead>
            <TableHead className="text-right">Latência</TableHead>
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.length === 0 ? (
            <TableRow>
              <TableCell colSpan={7} className="py-10 text-center text-muted-foreground">
                Nenhuma requisição encontrada.
              </TableCell>
            </TableRow>
          ) : (
            items.map((l) => {
              const s = statusLabel[l.status];
              return (
                <TableRow key={l.id}>
                  <TableCell className="text-muted-foreground tabular-nums">
                    {dateTimeBR(l.createdAt)}
                  </TableCell>
                  <TableCell>
                    <span className="font-mono text-xs">{l.model}</span>
                    {l.stream ? (
                      <span className="ml-1 text-muted-foreground text-xs">stream</span>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-xs">
                    {l.project}
                    {l.apiKey ? (
                      <span className="ml-1 font-mono text-muted-foreground">
                        {l.apiKey.prefix}…
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {l.promptTokens.toLocaleString('pt-BR')} /{' '}
                    {l.completionTokens.toLocaleString('pt-BR')}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {money(l.chargedMicros)}
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground tabular-nums">
                    {ms(l.latencyMs)}
                    {l.ttftMs != null ? (
                      <span className="block text-xs">1º token {ms(l.ttftMs)}</span>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    <Badge variant={s.variant} title={l.errorCode ?? undefined}>
                      {s.label}
                    </Badge>
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
