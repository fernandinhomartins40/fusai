import { formatBRL, formatDocument } from '@fuseai/shared';
import { Badge } from '@fuseai/ui/components/badge';
import { Button } from '@fuseai/ui/components/button';
import { Input } from '@fuseai/ui/components/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@fuseai/ui/components/table';
import { Search } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { PageHeader } from '@/components/admin/page-header';
import { billingTypeLabel } from '@/lib/admin-labels';
import { dateTimeBR } from '@/lib/format';
import { serverApi } from '@/lib/session';

export const metadata: Metadata = { title: 'Clientes' };

type OrgRow = {
  id: string;
  name: string;
  slug: string;
  document: string | null;
  status: 'ACTIVE' | 'SUSPENDED';
  billingType: 'PREPAID' | 'POSTPAID' | 'INTERNAL';
  members: number;
  projects: number;
  balanceMicros: string;
  reservedMicros: string;
  createdAt: string;
};

type Props = { searchParams: Promise<{ q?: string; cursor?: string }> };

export default async function CustomersPage({ searchParams }: Props) {
  const { q, cursor } = await searchParams;
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  if (cursor) params.set('cursor', cursor);
  const { data } = await serverApi<{ items: OrgRow[]; nextCursor: string | null }>(
    `/internal/admin/organizations?${params}`,
  );
  const items = data?.items ?? [];

  return (
    <div className="grid gap-6">
      <PageHeader title="Clientes" description="Organizações, carteiras e ajustes de saldo." />

      <form className="flex gap-2">
        <label htmlFor="q" className="sr-only">
          Buscar clientes
        </label>
        <Input
          id="q"
          name="q"
          defaultValue={q}
          placeholder="Nome, slug, CPF/CNPJ ou email"
          className="max-w-md"
        />
        <Button type="submit" variant="outline">
          <Search /> Buscar
        </Button>
      </form>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Cliente</TableHead>
            <TableHead>Documento</TableHead>
            <TableHead>Cobrança</TableHead>
            <TableHead className="text-right">Saldo</TableHead>
            <TableHead className="text-right">Projetos</TableHead>
            <TableHead>Desde</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.length === 0 ? (
            <TableRow>
              <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                {q ? 'Nenhum cliente encontrado.' : 'Nenhum cliente ainda.'}
              </TableCell>
            </TableRow>
          ) : (
            items.map((o) => (
              <TableRow key={o.id}>
                <TableCell>
                  <Link href={`/admin/clientes/${o.id}`} className="grid gap-0.5 hover:underline">
                    <span className="font-medium">{o.name}</span>
                    <span className="font-mono text-muted-foreground text-xs">{o.slug}</span>
                  </Link>
                </TableCell>
                <TableCell className="font-mono text-xs">
                  {o.document ? formatDocument(o.document) : '—'}
                </TableCell>
                <TableCell>
                  <span className="flex items-center gap-2">
                    {billingTypeLabel[o.billingType]}
                    {o.status === 'SUSPENDED' ? (
                      <Badge variant="destructive">suspenso</Badge>
                    ) : null}
                  </span>
                </TableCell>
                <TableCell
                  className={`text-right tabular-nums ${BigInt(o.balanceMicros) < 0n ? 'text-destructive' : ''}`}
                >
                  {formatBRL(BigInt(o.balanceMicros))}
                </TableCell>
                <TableCell className="text-right tabular-nums">{o.projects}</TableCell>
                <TableCell className="text-muted-foreground">{dateTimeBR(o.createdAt)}</TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>

      {data?.nextCursor || cursor ? (
        <div className="flex justify-between">
          {cursor ? (
            <Button asChild variant="ghost">
              <Link href={`/admin/clientes${q ? `?q=${encodeURIComponent(q)}` : ''}`}>Início</Link>
            </Button>
          ) : (
            <span />
          )}
          {data?.nextCursor ? (
            <Button asChild variant="outline">
              <Link
                href={`/admin/clientes?${new URLSearchParams({ ...(q ? { q } : {}), cursor: data.nextCursor })}`}
              >
                Próxima página
              </Link>
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
