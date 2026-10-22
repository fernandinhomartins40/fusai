'use client';

import { Button } from '@fusai/ui/components/button';
import { AlertTriangle } from 'lucide-react';
import Link from 'next/link';

/** Branded pt-BR error screen used by the error.tsx boundaries (no stack traces shown). */
export function ErrorState({
  reset,
  digest,
  homeHref = '/app',
}: {
  reset?: () => void;
  digest?: string;
  homeHref?: string;
}) {
  return (
    <div role="alert" className="flex min-h-[60dvh] items-center justify-center px-4">
      <div className="grid max-w-sm justify-items-center gap-4 text-center">
        <AlertTriangle className="size-10 text-warning-foreground" aria-hidden />
        <div className="grid gap-1">
          <h1 className="font-semibold text-2xl tracking-tight">Algo deu errado</h1>
          <p className="text-muted-foreground">
            Não foi possível carregar esta página. Tente de novo em alguns segundos.
          </p>
          {digest ? (
            <p className="font-mono text-muted-foreground text-xs">Código: {digest}</p>
          ) : null}
        </div>
        <div className="flex flex-wrap justify-center gap-2">
          {reset ? (
            <Button variant="brand" onClick={reset}>
              Tentar de novo
            </Button>
          ) : null}
          <Button asChild variant="outline">
            <Link href={homeHref}>Voltar ao início</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
