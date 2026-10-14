import { formatBRL, formatDocument } from '@fuseai/shared';
import { Badge } from '@fuseai/ui/components/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@fuseai/ui/components/card';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/admin/page-header';
import { WalletAdjustForm } from '@/components/admin/wallet-adjust-form';
import { LedgerTable } from '@/components/ledger-table';
import { WalletCards } from '@/components/wallet-cards';
import { billingModeLabel, billingTypeLabel, orgRoleLabel } from '@/lib/admin-labels';
import { serverApi } from '@/lib/session';
import type { LedgerPage, WalletInfo } from '@/lib/wallet-types';

export const metadata: Metadata = { title: 'Cliente' };

type OrgDetail = {
  id: string;
  name: string;
  slug: string;
  document: string | null;
  phone: string | null;
  status: 'ACTIVE' | 'SUSPENDED';
  billingType: keyof typeof billingTypeLabel;
  creditLimitMicros: string;
  members: { id: string; name: string; email: string; role: keyof typeof orgRoleLabel }[];
  projects: { id: string; name: string; slug: string; billingMode: string }[];
  wallet: WalletInfo & { activeHolds: number; ledgerSumMicros: string; consistent: boolean };
};

export default async function CustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [{ data: org }, { data: ledger }] = await Promise.all([
    serverApi<OrgDetail>(`/internal/admin/organizations/${id}`),
    serverApi<LedgerPage>(`/internal/admin/organizations/${id}/ledger`),
  ]);
  if (!org || !ledger) notFound();

  return (
    <div className="grid gap-6">
      <PageHeader
        title={org.name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-mono">{org.slug}</span>
            {org.document ? <span>· {formatDocument(org.document)}</span> : null}
            <Badge variant="outline">{billingTypeLabel[org.billingType]}</Badge>
            {org.status === 'SUSPENDED' ? <Badge variant="destructive">suspenso</Badge> : null}
          </span>
        }
      />

      <WalletCards wallet={org.wallet} />

      <div className="grid items-start gap-6 lg:grid-cols-[1fr_360px]">
        <section className="grid gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold text-lg">Extrato</h2>
            {org.wallet.consistent ? (
              <span className="flex items-center gap-1 text-muted-foreground text-xs">
                <CheckCircle2 className="size-3.5 text-success" aria-hidden /> Ledger confere com o
                saldo
              </span>
            ) : (
              <span className="flex items-center gap-1 text-destructive text-xs">
                <AlertTriangle className="size-3.5" aria-hidden /> Soma do ledger (
                {formatBRL(BigInt(org.wallet.ledgerSumMicros))}) difere do saldo
              </span>
            )}
          </div>
          <LedgerTable
            endpoint={`/internal/admin/organizations/${org.id}/ledger`}
            initial={ledger}
          />
        </section>

        <div className="grid gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Ajustar saldo</CardTitle>
              <CardDescription>
                {org.wallet.activeHolds > 0
                  ? `${org.wallet.activeHolds} requisição(ões) em andamento com saldo reservado.`
                  : 'Lançamento manual com motivo obrigatório.'}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <WalletAdjustForm orgId={org.id} orgName={org.name} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Membros</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="grid gap-2 text-sm">
                {org.members.map((m) => (
                  <li key={m.id} className="flex items-center justify-between gap-2">
                    <span className="grid min-w-0">
                      <span className="truncate font-medium">{m.name}</span>
                      <span className="truncate text-muted-foreground text-xs">{m.email}</span>
                    </span>
                    <Badge variant="outline">{orgRoleLabel[m.role]}</Badge>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Projetos</CardTitle>
            </CardHeader>
            <CardContent>
              {org.projects.length === 0 ? (
                <p className="text-muted-foreground text-sm">Nenhum projeto.</p>
              ) : (
                <ul className="grid gap-2 text-sm">
                  {org.projects.map((p) => (
                    <li key={p.id} className="flex items-center justify-between gap-2">
                      <span className="truncate font-medium">{p.name}</span>
                      <Badge variant="outline">
                        {billingModeLabel[p.billingMode] ?? p.billingMode}
                      </Badge>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
