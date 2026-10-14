import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ModelForm } from '@/components/admin/model-form';
import { PageHeader } from '@/components/admin/page-header';
import { loadModelFormData } from '@/lib/admin-data';

export const metadata: Metadata = { title: 'Editar modelo' };

export default async function EditModelPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await loadModelFormData();
  const model = data.models.find((m) => m.id === id);
  if (!model) notFound();

  return (
    <div className="grid gap-6">
      <PageHeader
        title={model.displayName}
        description={<span className="font-mono">{model.slug}</span>}
      />
      <ModelForm model={model} {...data} />
    </div>
  );
}
