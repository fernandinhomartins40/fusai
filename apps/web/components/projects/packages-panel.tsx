'use client';

import { brlToMicros, formatBRL } from '@fusai/shared';
import { Badge } from '@fusai/ui/components/badge';
import { Button } from '@fusai/ui/components/button';
import { Dialog } from '@fusai/ui/components/dialog';
import { Input } from '@fusai/ui/components/input';
import { Label } from '@fusai/ui/components/label';
import { Switch } from '@fusai/ui/components/switch';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@fusai/ui/components/table';
import { Loader2, Package, Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { Field, FormAlert } from '@/components/form-field';
import { ApiError, apiFetch } from '@/lib/api';
import type { ProjectPackage } from '@/lib/end-user-types';
import { brl, microsToInput } from '@/lib/format';

type Props = { projectId: string; packages: ProjectPackage[]; billingMode: string };

/** "Pacotes de créditos": what the project's end users can buy via Pix (PRD §12). */
export function PackagesPanel({ projectId, packages, billingMode }: Props) {
  const router = useRouter();
  const [editing, setEditing] = useState<ProjectPackage | 'new' | null>(null);

  async function remove(pkg: ProjectPackage) {
    if (!confirm(`Remover o pacote “${pkg.name}”?`)) return;
    try {
      const res = await apiFetch<{ deactivated: boolean }>(
        `/internal/projects/${projectId}/packages/${pkg.id}`,
        { method: 'DELETE' },
      );
      toast.success(
        res.deactivated
          ? 'Pacote desativado (já tem vendas, fica no histórico)'
          : 'Pacote removido',
      );
      router.refresh();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Não foi possível remover.');
    }
  }

  function close(saved: boolean) {
    setEditing(null);
    if (saved) router.refresh();
  }

  return (
    <section className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="grid gap-0.5">
          <h2 className="font-semibold text-lg">Pacotes de créditos</h2>
          <p className="text-muted-foreground text-sm">
            O que os usuários do seu app compram via Pix. O valor pago vai para a sua conta fusai;
            os créditos vão para a carteira do usuário.
          </p>
        </div>
        <Button variant="brand" onClick={() => setEditing('new')}>
          <Plus /> Novo pacote
        </Button>
      </div>

      {billingMode === 'ORG_WALLET' ? (
        <FormAlert>
          Este projeto está em “Carteira da organização”: usuários finais não compram créditos. Mude
          o modo de cobrança em Configurações para vender pacotes.
        </FormAlert>
      ) : null}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Pacote</TableHead>
            <TableHead className="text-right">Preço</TableHead>
            <TableHead className="text-right">Créditos</TableHead>
            <TableHead className="text-right">Bônus</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Ações</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {packages.length === 0 ? (
            <TableRow>
              <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                <Package className="mx-auto mb-2 size-5" aria-hidden />
                Nenhum pacote ainda. Crie o primeiro para vender créditos no seu app.
              </TableCell>
            </TableRow>
          ) : (
            packages.map((p) => (
              <TableRow key={p.id} className={p.active ? undefined : 'opacity-60'}>
                <TableCell className="font-medium">
                  <span className="flex items-center gap-2">
                    {p.name}
                    {p.highlight ? <Badge variant="outline">destaque</Badge> : null}
                  </span>
                  <code className="font-mono text-muted-foreground text-xs">{p.id}</code>
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatBRL(BigInt(p.priceCents) * 10_000n)}
                </TableCell>
                <TableCell className="text-right tabular-nums">{brl(p.creditMicros)}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {p.bonusMicros === '0' ? '—' : brl(p.bonusMicros)}
                </TableCell>
                <TableCell>
                  {p.active ? (
                    <Badge variant="success">ativo</Badge>
                  ) : (
                    <Badge variant="secondary">inativo</Badge>
                  )}
                </TableCell>
                <TableCell className="whitespace-nowrap text-right">
                  <Button variant="ghost" size="sm" onClick={() => setEditing(p)}>
                    Editar
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive"
                    onClick={() => remove(p)}
                  >
                    Remover
                  </Button>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>

      <Dialog
        open={editing !== null}
        onClose={() => close(false)}
        title={editing === 'new' ? 'Novo pacote' : 'Editar pacote'}
        description="Preço em reais; créditos e bônus em reais de saldo fusai."
      >
        {editing ? (
          <PackageForm
            projectId={projectId}
            pkg={editing === 'new' ? null : editing}
            onSaved={() => close(true)}
          />
        ) : null}
      </Dialog>
    </section>
  );
}

function PackageForm({
  projectId,
  pkg,
  onSaved,
}: {
  projectId: string;
  pkg: ProjectPackage | null;
  onSaved: () => void;
}) {
  const [name, setName] = useState(pkg?.name ?? '');
  const [price, setPrice] = useState(pkg ? microsToInput(String(pkg.priceCents * 10_000)) : '');
  const [credit, setCredit] = useState(pkg ? microsToInput(pkg.creditMicros) : '');
  const [bonus, setBonus] = useState(pkg ? microsToInput(pkg.bonusMicros) : '');
  const [highlight, setHighlight] = useState(pkg?.highlight ?? false);
  const [active, setActive] = useState(pkg?.active ?? true);
  const [order, setOrder] = useState(String(pkg?.sortOrder ?? 0));
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    let priceMicros: bigint;
    let creditMicros: bigint;
    let bonusMicros: bigint;
    try {
      priceMicros = brlToMicros(price);
      creditMicros = brlToMicros(credit);
      bonusMicros = bonus.trim() ? brlToMicros(bonus) : 0n;
    } catch {
      return setError('Use valores no formato 9,90.');
    }
    if (priceMicros % 10_000n !== 0n) return setError('O preço precisa estar em centavos.');
    setPending(true);
    try {
      await apiFetch(
        pkg
          ? `/internal/projects/${projectId}/packages/${pkg.id}`
          : `/internal/projects/${projectId}/packages`,
        {
          method: pkg ? 'PATCH' : 'POST',
          body: JSON.stringify({
            name: name.trim(),
            priceCents: Number(priceMicros / 10_000n),
            creditMicros: creditMicros.toString(),
            bonusMicros: bonusMicros.toString(),
            highlight,
            active,
            sortOrder: Number(order) || 0,
          }),
        },
      );
      toast.success(pkg ? 'Pacote atualizado' : 'Pacote criado');
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível salvar.');
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-4">
      {error ? <FormAlert>{error}</FormAlert> : null}
      <Field id="pkg-name" label="Nome" hint="Ex.: 100 mensagens, Plano mensal">
        <Input
          id="pkg-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          maxLength={60}
        />
      </Field>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field id="pkg-price" label="Preço (R$)" hint="Mínimo R$ 5,00">
          <Input
            id="pkg-price"
            inputMode="decimal"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            required
          />
        </Field>
        <Field id="pkg-credit" label="Créditos (R$)">
          <Input
            id="pkg-credit"
            inputMode="decimal"
            value={credit}
            onChange={(e) => setCredit(e.target.value)}
            required
          />
        </Field>
        <Field id="pkg-bonus" label="Bônus (R$)" hint="Opcional">
          <Input
            id="pkg-bonus"
            inputMode="decimal"
            value={bonus}
            onChange={(e) => setBonus(e.target.value)}
          />
        </Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-3 sm:items-end">
        <Field id="pkg-order" label="Ordem">
          <Input
            id="pkg-order"
            type="number"
            min={0}
            max={1000}
            value={order}
            onChange={(e) => setOrder(e.target.value)}
          />
        </Field>
        <div className="flex items-center gap-2 text-sm sm:pb-2">
          <Switch id="pkg-highlight" checked={highlight} onCheckedChange={setHighlight} />
          <Label htmlFor="pkg-highlight">Destaque</Label>
        </div>
        <div className="flex items-center gap-2 text-sm sm:pb-2">
          <Switch id="pkg-active" checked={active} onCheckedChange={setActive} />
          <Label htmlFor="pkg-active">Ativo</Label>
        </div>
      </div>
      <p className="text-muted-foreground text-xs">
        A margem é sua: o usuário paga o preço e recebe créditos + bônus, que são consumidos pelos
        preços da fusai.
      </p>
      <Button type="submit" variant="brand" disabled={pending || !name.trim()}>
        {pending ? <Loader2 className="animate-spin" /> : null}
        {pkg ? 'Salvar' : 'Criar pacote'}
      </Button>
    </form>
  );
}
