import { Badge } from '@fusai/ui/components/badge';
import { Button } from '@fusai/ui/components/button';
import { Card, CardContent, CardHeader, CardTitle } from '@fusai/ui/components/card';
import { KeyRound, Pencil, Plus } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { PageHeader } from '@/components/admin/page-header';
import { ProviderHealthRow } from '@/components/admin/provider-health';
import { ProviderTest } from '@/components/admin/provider-test';
import type { AdminProvider, ProviderHealth } from '@/lib/admin-types';
import { serverApi } from '@/lib/session';

export const metadata: Metadata = { title: 'Provedores' };

export default async function ProvidersPage() {
  const [{ data }, { data: healthData }] = await Promise.all([
    serverApi<{ providers: AdminProvider[] }>('/internal/admin/providers'),
    serverApi<{ providers: ProviderHealth[] }>('/internal/admin/providers/health'),
  ]);
  const providers = data?.providers ?? [];
  const health = new Map((healthData?.providers ?? []).map((h) => [h.providerId, h]));

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Provedores"
        description="Chaves dos provedores de IA. Ficam criptografadas e nunca são exibidas por inteiro."
        actions={
          <Button asChild variant="brand">
            <Link href="/admin/provedores/novo">
              <Plus /> Novo provedor
            </Link>
          </Button>
        }
      />

      {providers.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground text-sm">
            Nenhum provedor cadastrado. Cadastre o primeiro provedor para começar a vender.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {providers.map((p) => (
            <Card key={p.id}>
              <CardHeader className="gap-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="grid min-w-0 gap-1">
                    <CardTitle className="truncate">{p.name}</CardTitle>
                    <p className="truncate font-mono text-muted-foreground text-xs">{p.baseUrl}</p>
                  </div>
                  <Badge variant={p.status === 'ACTIVE' ? 'success' : 'secondary'}>
                    {p.status === 'ACTIVE' ? 'Ativo' : 'Desativado'}
                  </Badge>
                </div>
                <dl className="grid grid-cols-3 gap-2 text-xs">
                  <div>
                    <dt className="text-muted-foreground">Chave</dt>
                    <dd className="mt-0.5 flex items-center gap-1 font-mono">
                      <KeyRound className="size-3 shrink-0" aria-hidden />
                      {p.keyError ? (
                        <span className="text-destructive">erro</span>
                      ) : (
                        (p.keyMask ?? <span className="text-warning-foreground">sem chave</span>)
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Modelos</dt>
                    <dd className="mt-0.5 tabular-nums">{p.modelCount}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Prioridade</dt>
                    <dd className="mt-0.5 tabular-nums">{p.priority}</dd>
                  </div>
                </dl>
                <ProviderHealthRow health={health.get(p.id)} />
              </CardHeader>
              <CardContent className="grid gap-3">
                <div className="flex flex-wrap gap-2">
                  <Button asChild variant="outline" size="sm">
                    <Link href={`/admin/provedores/${p.id}`}>
                      <Pencil /> Editar
                    </Link>
                  </Button>
                  <ProviderTest providerId={p.id} disabled={!p.hasKey} />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
