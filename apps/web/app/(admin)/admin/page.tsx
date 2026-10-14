import { Card, CardDescription, CardHeader, CardTitle } from '@fuseai/ui/components/card';
import type { Metadata } from 'next';
import { serverApi } from '@/lib/session';

export const metadata: Metadata = { title: 'Admin' };

type Overview = { users: number; organizations: number; providers: number; activeModels: number };

export default async function AdminHomePage() {
  const { data } = await serverApi<Overview>('/internal/admin/overview');
  const stats = [
    { label: 'Usuários', value: data?.users },
    { label: 'Organizações', value: data?.organizations },
    { label: 'Provedores', value: data?.providers },
    { label: 'Modelos ativos', value: data?.activeModels },
  ];

  return (
    <div className="grid gap-6">
      <h1 className="font-semibold text-2xl tracking-tight">Visão geral</h1>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {stats.map((s) => (
          <Card key={s.label}>
            <CardHeader>
              <CardDescription>{s.label}</CardDescription>
              <CardTitle className="text-3xl tabular-nums">{s.value ?? '—'}</CardTitle>
            </CardHeader>
          </Card>
        ))}
      </div>
    </div>
  );
}
