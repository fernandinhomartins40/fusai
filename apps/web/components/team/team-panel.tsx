'use client';

import { Badge } from '@fuseai/ui/components/badge';
import { Button } from '@fuseai/ui/components/button';
import { Input } from '@fuseai/ui/components/input';
import { Select } from '@fuseai/ui/components/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@fuseai/ui/components/table';
import { Loader2, Send } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { FormAlert } from '@/components/form-field';
import { orgRoleLabel } from '@/lib/admin-labels';
import { ApiError, apiFetch } from '@/lib/api';
import type { OrgRole, TeamData } from '@/lib/dashboard-types';
import { dateTimeBR } from '@/lib/format';

const ROLE_HINT: Record<OrgRole, string> = {
  OWNER: 'Tudo, inclusive gerenciar donos',
  ADMIN: 'Equipe, projetos e cobrança',
  DEVELOPER: 'Projetos, chaves e modelos',
  BILLING: 'Carteira e consumo',
};

export function TeamPanel({
  orgId,
  data,
  myUserId,
}: {
  orgId: string;
  data: TeamData;
  myUserId: string;
}) {
  const router = useRouter();
  const canManage = data.myRole === 'OWNER' || data.myRole === 'ADMIN';
  const roles = (Object.keys(orgRoleLabel) as OrgRole[]).filter(
    (r) => r !== 'OWNER' || data.myRole === 'OWNER',
  );
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<OrgRole>('DEVELOPER');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function act(fn: () => Promise<unknown>, success: string) {
    try {
      await fn();
      toast.success(success);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Não foi possível concluir.');
    }
  }

  async function invite(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setPending(true);
    try {
      await apiFetch(`/internal/organizations/${orgId}/invitations`, {
        method: 'POST',
        body: JSON.stringify({ email, role }),
      });
      toast.success(`Convite enviado para ${email}`);
      setEmail('');
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível convidar.');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="grid gap-6">
      {canManage ? (
        <form onSubmit={invite} className="grid gap-3 rounded-2xl border p-4">
          <h2 className="font-semibold">Convidar pessoa</h2>
          {error ? <FormAlert>{error}</FormAlert> : null}
          <div className="grid gap-3 sm:grid-cols-[1fr_200px_auto]">
            <label htmlFor="invite-email" className="grid gap-1 text-sm">
              <span className="text-muted-foreground text-xs">Email</span>
              <Input
                id="invite-email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="pessoa@empresa.com"
              />
            </label>
            <label htmlFor="invite-role" className="grid gap-1 text-sm">
              <span className="text-muted-foreground text-xs">Papel</span>
              <Select
                id="invite-role"
                value={role}
                onChange={(e) => setRole(e.target.value as OrgRole)}
              >
                {roles.map((r) => (
                  <option key={r} value={r}>
                    {orgRoleLabel[r]} — {ROLE_HINT[r]}
                  </option>
                ))}
              </Select>
            </label>
            <Button type="submit" variant="brand" disabled={pending || !email} className="self-end">
              {pending ? <Loader2 className="animate-spin" /> : <Send />}
              Convidar
            </Button>
          </div>
        </form>
      ) : null}

      <section className="grid gap-3">
        <h2 className="font-semibold text-lg">Membros</h2>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Pessoa</TableHead>
              <TableHead>Papel</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.members.map((m) => {
              const isMe = m.userId === myUserId;
              const editable =
                canManage && !isMe && (data.myRole === 'OWNER' || m.role !== 'OWNER');
              return (
                <TableRow key={m.userId}>
                  <TableCell>
                    <span className="grid">
                      <span className="font-medium">
                        {m.name}{' '}
                        {isMe ? (
                          <span className="text-muted-foreground text-xs">(você)</span>
                        ) : null}
                      </span>
                      <span className="text-muted-foreground text-xs">{m.email}</span>
                    </span>
                  </TableCell>
                  <TableCell>
                    {editable ? (
                      <Select
                        aria-label={`Papel de ${m.name}`}
                        value={m.role}
                        className="h-8 w-40"
                        onChange={(e) =>
                          act(
                            () =>
                              apiFetch(`/internal/organizations/${orgId}/members/${m.userId}`, {
                                method: 'PATCH',
                                body: JSON.stringify({ role: e.target.value }),
                              }),
                            'Papel atualizado',
                          )
                        }
                      >
                        {roles.map((r) => (
                          <option key={r} value={r}>
                            {orgRoleLabel[r]}
                          </option>
                        ))}
                      </Select>
                    ) : (
                      <Badge variant="outline">{orgRoleLabel[m.role]}</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    {editable || isMe ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive"
                        onClick={() => {
                          if (!confirm(isMe ? 'Sair desta organização?' : `Remover ${m.name}?`))
                            return;
                          act(
                            async () => {
                              await apiFetch(
                                `/internal/organizations/${orgId}/members/${m.userId}`,
                                { method: 'DELETE' },
                              );
                              if (isMe) window.location.assign('/app');
                            },
                            isMe ? 'Você saiu da organização' : 'Membro removido',
                          );
                        }}
                      >
                        {isMe ? 'Sair' : 'Remover'}
                      </Button>
                    ) : null}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </section>

      {data.invitations.length ? (
        <section className="grid gap-3">
          <h2 className="font-semibold text-lg">Convites pendentes</h2>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Email</TableHead>
                <TableHead>Papel</TableHead>
                <TableHead>Expira</TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.invitations.map((i) => (
                <TableRow key={i.id}>
                  <TableCell>{i.email}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{orgRoleLabel[i.role]}</Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{dateTimeBR(i.expiresAt)}</TableCell>
                  <TableCell className="text-right">
                    {canManage ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          act(
                            () => apiFetch(`/internal/invitations/${i.id}`, { method: 'DELETE' }),
                            'Convite cancelado',
                          )
                        }
                      >
                        Cancelar
                      </Button>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </section>
      ) : null}
    </div>
  );
}
