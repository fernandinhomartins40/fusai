import { Logo } from '@fusai/ui/logo';
import { TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { SiteFooter } from '@/components/site-footer';
import { ThemeToggle } from '@/components/theme-toggle';
import { legal } from '@/lib/legal';

/** Shell for /termos and /privacidade: readable column, draft banner while under legal review. */
export function LegalPage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-5 sm:px-6">
        <Link href="/" aria-label="fusai — página inicial" className="rounded-lg">
          <Logo />
        </Link>
        <ThemeToggle />
      </header>
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 pt-6 pb-20 sm:px-6">
        {legal.draft ? (
          <div
            role="note"
            className="mb-8 flex gap-3 rounded-xl border border-warning/40 bg-warning/10 p-4 text-sm"
          >
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning-foreground" aria-hidden />
            <p>
              <strong>Rascunho — sujeito a revisão jurídica.</strong> Este texto descreve como a
              plataforma funciona hoje, mas ainda não foi revisado por advogado e pode mudar.
            </p>
          </div>
        ) : null}
        <h1 className="font-semibold text-3xl tracking-tight">{title}</h1>
        <p className="mt-2 text-muted-foreground text-sm">Atualizado em {legal.updatedAt}</p>
        <div className="mt-8 grid gap-8 text-[15px] leading-relaxed [&_a]:underline [&_a]:underline-offset-4 [&_h2]:mb-3 [&_h2]:font-semibold [&_h2]:text-foreground [&_h2]:text-xl [&_li]:mt-1.5 [&_p+p]:mt-3 [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:text-muted-foreground [&_p]:text-muted-foreground">
          {children}
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
