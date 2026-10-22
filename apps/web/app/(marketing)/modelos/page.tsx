import { Button } from '@fusai/ui/components/button';
import type { Metadata } from 'next';
import Link from 'next/link';
import { ModelsTable } from '@/components/marketing/models-table';
import { SiteHeader } from '@/components/marketing/site-header';
import { SiteFooter } from '@/components/site-footer';
import { getPublicCatalog } from '@/lib/public-models';

export const metadata: Metadata = {
  title: 'Modelos',
  description:
    'Modelos de IA disponíveis na fusai (DeepSeek, Kimi, GLM, Qwen, MiniMax e outros), com janela de contexto, recursos e preço em reais por milhão de tokens.',
  alternates: { canonical: '/modelos' },
};

export default async function ModelsPage() {
  const { models } = await getPublicCatalog();
  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader />
      <main id="conteudo" className="mx-auto w-full max-w-6xl flex-1 px-4 pt-12 pb-20 sm:px-6">
        <h1 className="font-semibold text-4xl tracking-tight">Modelos</h1>
        <p className="mt-3 max-w-2xl text-muted-foreground">
          Todos os modelos ativos, do mais barato ao mais caro. Use o id na chamada (
          <code className="font-mono text-sm">model</code>) ou{' '}
          <code className="font-mono text-sm">fuse/auto</code> para que a fusai escolha a cada
          pedido o mais barato que atende o que você pediu.
        </p>
        <div className="mt-8">
          <ModelsTable models={models} showCapabilities />
        </div>
        <p className="mt-4 text-muted-foreground text-sm">
          Preços em reais por milhão de tokens. Cada chamada é cobrada pelo preço da tabela no
          momento em que é feita. Com a sua chave, <code className="font-mono">GET /v1/models</code>{' '}
          mostra os modelos liberados para o seu projeto.
        </p>
        <div className="mt-8 flex flex-wrap gap-2">
          <Button asChild variant="brand">
            <Link href="/cadastro">Criar conta</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/precos">Como funcionam os preços</Link>
          </Button>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
