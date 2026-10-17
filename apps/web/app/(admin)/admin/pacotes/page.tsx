import type { Metadata } from 'next';
import { PageHeader } from '@/components/admin/page-header';
import { PackagesPanel } from '@/components/projects/packages-panel';
import type { ProjectPackage } from '@/lib/end-user-types';
import { serverApi } from '@/lib/session';

export const metadata: Metadata = { title: 'Pacotes' };

export default async function GlobalPackagesPage() {
  const { data } = await serverApi<{ packages: ProjectPackage[] }>('/internal/admin/packages');
  if (!data) throw new Error('Não foi possível carregar os pacotes');
  return (
    <div className="grid gap-6">
      <PageHeader
        title="Pacotes de recarga"
        description="Valores prontos (com bônus opcional) que os clientes veem em Carteira → Adicionar créditos."
      />
      <PackagesPanel
        basePath="/internal/admin/packages"
        packages={data.packages}
        intro="O cliente paga o preço via Pix e recebe os créditos mais o bônus na carteira da organização."
        emptyText="Nenhum pacote: os clientes digitam o valor da recarga."
      />
    </div>
  );
}
