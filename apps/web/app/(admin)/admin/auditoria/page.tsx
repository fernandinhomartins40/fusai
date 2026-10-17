import { Button } from '@fusai/ui/components/button';
import { Input } from '@fusai/ui/components/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@fusai/ui/components/table';
import { Search } from 'lucide-react';
import type { Metadata } from 'next';
import { PageHeader } from '@/components/admin/page-header';
import { Pager } from '@/components/admin/pager';
import { FilterFrame } from '@/components/filter-frame';
import type { AdminAuditEntry, Page } from '@/lib/admin-types';
import { dateTimeBR } from '@/lib/format';
import { serverApi } from '@/lib/session';

export const metadata: Metadata = { title: 'Auditoria' };

/** Readable names for the actions recorded by the API (unknown ones show the raw code). */
const ACTIONS: Record<string, string> = {
  'wallet.adjust': 'Ajuste de saldo',
  'org.suspend': 'Cliente suspenso',
  'org.reactivate': 'Cliente reativado',
  'org.update': 'Conta do cliente alterada',
  'user.ban': 'Usuário bloqueado',
  'user.unban': 'Usuário desbloqueado',
  'user.revoke_sessions': 'Sessões encerradas',
  'impersonate.start': 'Entrou como cliente',
  'impersonate.stop': 'Saiu do modo cliente',
  'api_key.create': 'Chave de API criada',
  'api_key.revoke': 'Chave de API revogada',
  'payment.create': 'Recarga criada',
  'payment.refund_requested': 'Estorno solicitado',
  'package.create': 'Pacote criado',
  'package.update': 'Pacote alterado',
  'package.delete': 'Pacote removido',
  'provider.create': 'Provedor criado',
  'provider.update': 'Provedor alterado',
  'model.create': 'Modelo criado',
  'model.update': 'Modelo alterado',
  'settings.update': 'Preços globais alterados',
  'webhook.reprocess': 'Webhook reprocessado',
};

const FILTERS = [
  { value: '', label: 'Todas' },
  { value: 'wallet', label: 'Saldo' },
  { value: 'org', label: 'Clientes' },
  { value: 'user', label: 'Usuários' },
  { value: 'impersonate', label: 'Entrar como cliente' },
  { value: 'api_key', label: 'Chaves de API' },
  { value: 'payment', label: 'Pagamentos' },
  { value: 'package', label: 'Pacotes' },
  { value: 'provider', label: 'Provedores' },
  { value: 'model', label: 'Modelos' },
  { value: 'settings', label: 'Preços globais' },
  { value: 'webhook', label: 'Webhooks' },
];

type Props = { searchParams: Promise<{ acao?: string; q?: string; cursor?: string }> };

/** Compact, secret-free view of the metadata recorded with each action. */
function Details({ metadata }: { metadata: Record<string, unknown> | null }) {
  if (!metadata || Object.keys(metadata).length === 0) return null;
  const text = JSON.stringify(metadata);
  return (
    <code className="block max-w-md break-all font-mono text-muted-foreground text-xs">
      {text.length > 240 ? `${text.slice(0, 240)}…` : text}
    </code>
  );
}

export default async function AuditPage({ searchParams }: Props) {
  const sp = await searchParams;
  const query = new URLSearchParams();
  if (sp.acao) query.set('action', sp.acao);
  if (sp.q) query.set('q', sp.q);
  if (sp.cursor) query.set('cursor', sp.cursor);
  const { data } = await serverApi<Page<AdminAuditEntry>>(`/internal/admin/audit?${query}`);
  const items = data?.items ?? [];

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Auditoria"
        description="Toda ação administrativa e financeira, com quem fez, quando e de qual IP."
      />
      <form className="flex gap-2">
        {sp.acao ? <input type="hidden" name="acao" value={sp.acao} /> : null}
        <label htmlFor="q" className="sr-only">
          Buscar por email ou ID
        </label>
        <Input
          id="q"
          name="q"
          defaultValue={sp.q}
          placeholder="Email de quem fez ou ID do alvo"
          className="max-w-md"
        />
        <Button type="submit" variant="outline">
          <Search /> Buscar
        </Button>
      </form>
      <FilterFrame filters={[{ name: 'acao', label: 'Tipo de ação', options: FILTERS }]}>
        <div className="grid gap-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Quando</TableHead>
                <TableHead>Ação</TableHead>
                <TableHead>Quem</TableHead>
                <TableHead>Detalhes</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="py-10 text-center text-muted-foreground">
                    Nenhum registro.
                  </TableCell>
                </TableRow>
              ) : (
                items.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell className="whitespace-nowrap">
                      {dateTimeBR(a.createdAt)}
                      {a.ip ? (
                        <span className="block text-muted-foreground text-xs">{a.ip}</span>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <span className="font-medium">{ACTIONS[a.action] ?? a.action}</span>
                      {a.target ? (
                        <code className="block font-mono text-muted-foreground text-xs">
                          {a.target}
                        </code>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      {a.actor ? (
                        <span className="grid">
                          <span>{a.actor.name ?? 'Usuário removido'}</span>
                          <span className="text-muted-foreground text-xs">{a.actor.email}</span>
                        </span>
                      ) : (
                        <span className="text-muted-foreground">sistema</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Details metadata={a.metadata} />
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
          <Pager
            path="/admin/auditoria"
            params={sp}
            cursor={sp.cursor}
            nextCursor={data?.nextCursor}
          />
        </div>
      </FilterFrame>
    </div>
  );
}
