import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ApiKeysPanel } from '@/components/api-keys/api-keys-panel';
import type { ApiKeyInfo } from '@/lib/api-key-types';
import { serverApi } from '@/lib/session';

export const metadata: Metadata = { title: 'Chaves de API' };

export default async function ProjectKeysPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { data } = await serverApi<{ keys: ApiKeyInfo[] }>(`/internal/projects/${id}/api-keys`);
  if (!data) notFound();
  return <ApiKeysPanel projectId={id} keys={data.keys} />;
}
