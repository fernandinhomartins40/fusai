import { formatBRL } from '@fuseai/shared';
import { Badge } from '@fuseai/ui/components/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@fuseai/ui/components/card';
import { FolderKanban, Wallet } from 'lucide-react';
import type { Metadata } from 'next';
import { getMe } from '@/lib/session';

export const metadata: Metadata = { title: 'Visão geral' };

const billingModeLabel: Record<string, string> = {
  ORG_WALLET: 'Carteira da organização',
  END_USER_WALLET: 'Carteira do usuário final',
  HYBRID: 'Híbrido',
};

export default async function OverviewPage() {
  const me = await getMe();
  const org = me?.organizations[0];
  if (!org) return null;
  const available = BigInt(org.balanceMicros) - BigInt(org.reservedMicros);

  return (
    <div className="grid gap-6">
      <div>
        <p className="text-muted-foreground text-sm">{org.name}</p>
        <h1 className="font-semibold text-2xl tracking-tight">
          Olá, {me.user.name.split(' ')[0]}!
        </h1>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardDescription className="flex items-center gap-2">
              <Wallet className="size-4" aria-hidden /> Saldo
            </CardDescription>
            <CardTitle className="text-3xl tabular-nums">
              {formatBRL(available)}{' '}
              <span className="font-normal text-base text-muted-foreground">em créditos</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {org.billingType === 'INTERNAL' ? (
              <Badge variant="secondary">Organização interna · sem cobrança</Badge>
            ) : (
              <p className="text-muted-foreground text-sm">A recarga via Pix chega em breve.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardDescription className="flex items-center gap-2">
              <FolderKanban className="size-4" aria-hidden /> Projetos
            </CardDescription>
            <CardTitle className="text-3xl tabular-nums">{org.projects.length}</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="grid gap-2">
              {org.projects.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-2 text-sm">
                  <span className="truncate font-medium">{p.name}</span>
                  <Badge variant="outline">
                    {billingModeLabel[p.billingMode] ?? p.billingMode}
                  </Badge>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
