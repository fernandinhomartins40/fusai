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
import { Plus } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { ModelActiveToggle } from '@/components/admin/model-active-toggle';
import { PageHeader } from '@/components/admin/page-header';
import type { AdminModel, AdminSettings } from '@/lib/admin-types';
import { brl, pct } from '@/lib/format';
import { serverApi } from '@/lib/session';

export const metadata: Metadata = { title: 'Modelos' };

export default async function ModelsPage() {
  const [{ data }, { data: settings }] = await Promise.all([
    serverApi<{ models: AdminModel[] }>('/internal/admin/models'),
    serverApi<AdminSettings>('/internal/admin/settings'),
  ]);
  const models = data?.models ?? [];

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Modelos"
        description={
          settings
            ? `Preços em R$ por 1M de tokens · câmbio ${settings.usd_brl_rate.replace('.', ',')} · margem padrão ${settings.default_markup.replace('.', ',')}×`
            : undefined
        }
        actions={
          <Button asChild variant="brand">
            <Link href="/admin/modelos/novo">
              <Plus /> Novo modelo
            </Link>
          </Button>
        }
      />

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Modelo</TableHead>
            <TableHead>Provedor</TableHead>
            <TableHead className="text-right">Entrada</TableHead>
            <TableHead className="text-right">Saída</TableHead>
            <TableHead className="text-right">Margem</TableHead>
            <TableHead>Ativo</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {models.length === 0 ? (
            <TableRow>
              <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                Nenhum modelo cadastrado.
              </TableCell>
            </TableRow>
          ) : (
            models.map((m) => (
              <TableRow key={m.id}>
                <TableCell>
                  <Link href={`/admin/modelos/${m.id}`} className="grid gap-0.5 hover:underline">
                    <span className="font-medium">{m.displayName}</span>
                    <span className="font-mono text-muted-foreground text-xs">{m.slug}</span>
                  </Link>
                </TableCell>
                <TableCell>
                  <span className="flex items-center gap-2">
                    {m.provider.name}
                    {m.provider.status !== 'ACTIVE' ? (
                      <Badge variant="warning">desativado</Badge>
                    ) : null}
                  </span>
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {brl(m.pricing.inputPerM)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {brl(m.pricing.outputPerM)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  <span className={m.pricing.outputMarginBps < 0 ? 'text-destructive' : undefined}>
                    {pct(m.pricing.outputMarginBps)}
                  </span>
                  {m.priceMode === 'FIXED' ? (
                    <Badge variant="outline" className="ml-2">
                      fixo
                    </Badge>
                  ) : null}
                </TableCell>
                <TableCell>
                  <ModelActiveToggle id={m.id} active={m.active} label={m.displayName} />
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}
