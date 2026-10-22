import { Button } from '@fusai/ui/components/button';
import { Logo } from '@fusai/ui/logo';
import { SearchX } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = { title: 'Página não encontrada' };

export default function NotFound() {
  return (
    <main className="flex min-h-dvh items-center justify-center px-4">
      <div className="grid max-w-sm justify-items-center gap-4 text-center">
        <Logo />
        <SearchX className="size-10 text-muted-foreground" aria-hidden />
        <div className="grid gap-1">
          <p className="font-mono text-muted-foreground text-sm">404</p>
          <h1 className="font-semibold text-2xl tracking-tight">Página não encontrada</h1>
          <p className="text-muted-foreground">O endereço pode ter mudado ou não existe mais.</p>
        </div>
        <div className="flex flex-wrap justify-center gap-2">
          <Button asChild variant="brand">
            <Link href="/">Ir para o início</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/docs">Ver docs</Link>
          </Button>
        </div>
      </div>
    </main>
  );
}
