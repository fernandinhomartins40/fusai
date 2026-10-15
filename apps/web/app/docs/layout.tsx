import { DOC_PAGES } from '@fusai/docs';
import { Logo } from '@fusai/ui/logo';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { DocsNav } from '@/components/docs/docs-nav';
import { ThemeToggle } from '@/components/theme-toggle';

export default function DocsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-30 border-b bg-background/80 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
          <div className="flex items-center gap-3">
            <Link href="/" aria-label="fusai — página inicial">
              <Logo />
            </Link>
            <span className="text-muted-foreground text-sm">Docs</span>
          </div>
          <nav className="flex items-center gap-1 text-sm">
            <Link
              href="/entrar"
              className="rounded-lg px-3 py-1.5 text-muted-foreground hover:text-foreground"
            >
              Entrar
            </Link>
            <ThemeToggle />
          </nav>
        </div>
      </header>
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-8 sm:px-6 md:grid-cols-[13rem_minmax(0,1fr)]">
        <DocsNav items={DOC_PAGES.map((p) => ({ slug: p.slug, title: p.title }))} />
        <main id="conteudo" className="min-w-0">
          {children}
        </main>
      </div>
    </div>
  );
}
