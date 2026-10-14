import type { Metadata } from 'next';
import { ModelForm } from '@/components/admin/model-form';
import { PageHeader } from '@/components/admin/page-header';
import { loadModelFormData } from '@/lib/admin-data';

export const metadata: Metadata = { title: 'Novo modelo' };

export default async function NewModelPage() {
  const data = await loadModelFormData();
  return (
    <div className="grid gap-6">
      <PageHeader title="Novo modelo" description="O preço em R$ é calculado ao vivo." />
      <ModelForm {...data} />
    </div>
  );
}
