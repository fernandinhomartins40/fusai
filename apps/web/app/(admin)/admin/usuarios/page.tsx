import { Badge } from '@fusai/ui/components/badge';
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
import Link from 'next/link';
import { PageHeader } from '@/components/admin/page-header';
import { Pager } from '@/components/admin/pager';
import { UserActions } from '@/components/admin/user-actions';
import type { AdminUser, Page } from '@/lib/admin-types';
import { dateTimeBR } from '@/lib/format';
import { serverApi } from '@/lib/session';

export const metadata: Metadata = { title: 'Usuários' };

type Props = { searchParams: Promise<{ q?: string; cursor?: string }> };

export default async function UsersPage({ searchParams }: Props) {
  const sp = await searchParams;
  const params = new URLSearchParams();
  if (sp.q) params.set('q', sp.q);
  if (sp.cursor) params.set('cursor', sp.cursor);
  const { data } = await serverApi<Page<AdminUser>>(`/internal/admin/users?${params}`);
  const items = data?.items ?? [];

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Usuários"
        description="Quem entra no painel: bloquear acesso, desconectar ou entrar como o usuário."
      />

      <form className="flex gap-2">
        <label htmlFor="q" className="sr-only">
          Buscar usuários
        </label>
        <Input
          id="q"
          name="q"
          defaultValue={sp.q}
          placeholder="Nome ou email"
          className="max-w-md"
        />
        <Button type="submit" variant="outline">
          <Search /> Buscar
        </Button>
      </form>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Usuário</TableHead>
            <TableHead>Organizações</TableHead>
            <TableHead>Último acesso</TableHead>
            <TableHead className="text-right">Ações</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.length === 0 ? (
            <TableRow>
              <TableCell colSpan={4} className="py-10 text-center text-muted-foreground">
                Nenhum usuário encontrado.
              </TableCell>
            </TableRow>
          ) : (
            items.map((u) => (
              <TableRow key={u.id} className={u.banned ? 'opacity-70' : undefined}>
                <TableCell>
                  <span className="grid gap-0.5">
                    <span className="flex flex-wrap items-center gap-1.5 font-medium">
                      {u.name}
                      {u.role === 'SUPER_ADMIN' ? (
                        <Badge variant="outline">super admin</Badge>
                      ) : null}
                      {u.banned ? <Badge variant="destructive">bloqueado</Badge> : null}
                      {u.emailVerified ? null : (
                        <Badge variant="secondary">email não confirmado</Badge>
                      )}
                    </span>
                    <span className="text-muted-foreground text-xs">{u.email}</span>
                    {u.banned && u.banReason ? (
                      <span className="text-destructive text-xs">Motivo: {u.banReason}</span>
                    ) : null}
                  </span>
                </TableCell>
                <TableCell>
                  {u.organizations.length === 0 ? (
                    <span className="text-muted-foreground text-xs">nenhuma</span>
                  ) : (
                    <span className="grid gap-0.5 text-sm">
                      {u.organizations.map((o) => (
                        <Link
                          key={o.id}
                          href={`/admin/clientes/${o.id}`}
                          className="hover:underline"
                        >
                          {o.name}
                        </Link>
                      ))}
                    </span>
                  )}
                </TableCell>
                <TableCell className="whitespace-nowrap text-muted-foreground text-sm">
                  {u.lastSeenAt ? dateTimeBR(u.lastSeenAt) : '—'}
                  <span className="block text-xs">desde {dateTimeBR(u.createdAt)}</span>
                </TableCell>
                <TableCell>
                  <UserActions user={u} />
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>

      <Pager path="/admin/usuarios" params={sp} cursor={sp.cursor} nextCursor={data?.nextCursor} />
    </div>
  );
}
