import { Card, CardContent } from '@fuseai/ui/components/card';
import type { Metadata } from 'next';
import { PageHeader } from '@/components/admin/page-header';
import { ProviderForm } from '@/components/admin/provider-form';

export const metadata: Metadata = { title: 'Novo provedor' };

export default function NewProviderPage() {
  return (
    <div className="mx-auto grid max-w-2xl gap-6">
      <PageHeader title="Novo provedor" description="Qualquer API compatível com OpenAI." />
      <Card>
        <CardContent className="pt-6">
          <ProviderForm />
        </CardContent>
      </Card>
    </div>
  );
}
