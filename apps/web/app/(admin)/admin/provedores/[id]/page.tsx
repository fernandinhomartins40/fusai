import { Card, CardContent } from '@fusai/ui/components/card';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/admin/page-header';
import { ProviderForm } from '@/components/admin/provider-form';
import { ProviderTest } from '@/components/admin/provider-test';
import type { AdminProvider } from '@/lib/admin-types';
import { serverApi } from '@/lib/session';

export const metadata: Metadata = { title: 'Editar provedor' };

export default async function EditProviderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { data: provider } = await serverApi<AdminProvider>(`/internal/admin/providers/${id}`);
  if (!provider) notFound();

  return (
    <div className="mx-auto grid max-w-2xl gap-6">
      <PageHeader
        title={provider.name}
        description={`${provider.modelCount} modelo(s) usam este provedor.`}
      />
      <Card>
        <CardContent className="flex flex-wrap gap-2 pt-6">
          <ProviderTest providerId={provider.id} disabled={!provider.hasKey} />
        </CardContent>
      </Card>
      <Card>
        <CardContent className="pt-6">
          <ProviderForm provider={provider} />
        </CardContent>
      </Card>
    </div>
  );
}
