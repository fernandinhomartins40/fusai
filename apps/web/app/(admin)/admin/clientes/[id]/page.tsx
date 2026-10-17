import { formatBRL, formatDocument } from '@fusai/shared';
import { Badge } from '@fusai/ui/components/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@fusai/ui/components/card';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AdminApiKeys } from '@/components/admin/admin-api-keys';
import { ImpersonateButton } from '@/components/admin/impersonate-button';
import { OrgAccountForm } from '@/components/admin/org-account-form';
import { PageHeader } from '@/components/admin/page-header';
import { RefundButton } from '@/components/admin/refund-button';
import { WalletAdjustForm } from '@/components/admin/wallet-adjust-form';
import { LedgerTable } from '@/components/ledger-table';
import { PaymentsTable } from '@/components/payments-table';
import { StatTile } from '@/components/stat-tile';
import { WalletCards } from '@/components/wallet-cards';
import { billingModeLabel, billingTypeLabel, orgRoleLabel } from '@/lib/admin-labels';
import type { AdminApiKey, AdminSettings } from '@/lib/admin-types';
import { intBR } from '@/lib/format';
import type { PaymentInfo } from '@/lib/payment-types';
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
  markupOverride: string | null;
  usage30d: { requests: number; chargedMicros: string; costMicros: string };
  members: { id: string; name: string; email: string; role: keyof typeof orgRoleLabel }[];
  projects: { id: string; name: string; slug: string; billingMode: string }[];
  wallet: WalletInfo & { activeHolds: number; ledgerSumMicros: string; consistent: boolean };
};

export default async function CustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [{ data: org }, { data: ledger }, { data: keys }, { data: payments }, { data: settings }] =
    await Promise.all([
      serverApi<OrgDetail>(`/internal/admin/organizations/${id}`),
      serverApi<LedgerPage>(`/internal/admin/organizations/${id}/ledger`),
      serverApi<{ items: AdminApiKey[] }>(`/internal/admin/organizations/${id}/api-keys`),
      serverApi<{ items: (PaymentInfo & { org?: unknown })[] }>(
        `/internal/admin/payments?orgId=${id}`,
      ),
      serverApi<AdminSettings>('/internal/admin/settings'),
    ]);
  if (!org || !ledger) notFound();
  const charged = BigInt(org.usage30d.chargedMicros);
  const margin = charged - BigInt(org.usage30d.costMicros);

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

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <StatTile
          label="Consumo (30 dias)"
          value={formatBRL(charged)}
          hint={`${intBR(org.usage30d.requests)} requisições`}
        />
        <StatTile
          label="Margem (30 dias)"
          value={formatBRL(margin)}
          hint={`custo ${formatBRL(BigInt(org.usage30d.costMicros))}`}
        />
        <StatTile
          className="col-span-2 lg:col-span-1"
          label="Uso detalhado"
          value={
            <Link href={`/admin/uso?cliente=${org.id}`} className="text-base hover:underline">
              Ver requisições →
            </Link>
          }
        />
      </div>

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
          <h2 className="mt-4 font-semibold text-lg">Pagamentos Pix</h2>
          <PaymentsTable
            // Same customer on every row: no "Cliente" column.
            items={(payments?.items ?? []).map(({ org: _org, ...p }) => p)}
            extraColumn={{
              header: 'Ações',
              cell: (p) =>
                p.status === 'RECEIVED' && p.creditedAt ? <RefundButton paymentId={p.id} /> : null,
            }}
          />
        </section>

        <div className="grid gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Liberar ou debitar créditos</CardTitle>
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
                  <li key={m.id} className="flex flex-wrap items-center justify-between gap-2">
                    <span className="grid min-w-0">
                      <span className="flex items-center gap-1.5">
                        <span className="truncate font-medium">{m.name}</span>
                        <Badge variant="outline">{orgRoleLabel[m.role]}</Badge>
                      </span>
                      <span className="truncate text-muted-foreground text-xs">{m.email}</span>
                    </span>
                    <ImpersonateButton userId={m.id} name={m.name} />
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Conta</CardTitle>
              <CardDescription>Situação, cobrança e margem especial deste cliente.</CardDescription>
            </CardHeader>
            <CardContent>
              <OrgAccountForm org={org} defaultMarkup={settings?.default_markup ?? '4.0'} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Chaves de API</CardTitle>
              <CardDescription>Só o prefixo: a chave completa nunca é guardada.</CardDescription>
            </CardHeader>
            <CardContent>
              <AdminApiKeys keys={keys?.items ?? []} />
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
