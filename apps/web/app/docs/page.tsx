import { DOC_PAGES } from '@fuseai/docs';
import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Documentação',
  description:
    'API compatível com OpenAI, créditos em reais, Pix para você e para os usuários do seu app, e MCP para a sua IA de programação.',
  alternates: { canonical: '/docs' },
};

export default function DocsIndex() {
  return (
    <div className="grid gap-8">
      <header className="grid gap-2">
        <h1 className="font-semibold text-3xl tracking-tight">Documentação</h1>
        <p className="text-lg text-muted-foreground">
          Uma API compatível com a da OpenAI, os melhores modelos e pagamento com Pix. Comece pelo{' '}
          <Link href="/docs/inicio-rapido" className="text-foreground underline underline-offset-4">
            início rápido
          </Link>{' '}
          ou conecte sua IA de programação pelo{' '}
          <Link href="/docs/mcp" className="text-foreground underline underline-offset-4">
            MCP
          </Link>
          .
        </p>
        <p className="text-muted-foreground text-sm">
          Para IAs:{' '}
          <a href="/llms.txt" className="underline underline-offset-4">
            /llms.txt
          </a>{' '}
          e{' '}
          <a href="/llms-full.txt" className="underline underline-offset-4">
            /llms-full.txt
          </a>
          .
        </p>
      </header>
      <ul className="grid gap-3 sm:grid-cols-2">
        {DOC_PAGES.map((p) => (
          <li key={p.slug}>
            <Link
              href={`/docs/${p.slug}`}
              className="grid h-full gap-1 rounded-2xl border p-4 transition-colors hover:bg-accent/50"
            >
              <span className="font-medium">{p.title}</span>
              <span className="text-muted-foreground text-sm">{p.description}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
