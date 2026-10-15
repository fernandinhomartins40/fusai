import { Button } from '@fusai/ui/components/button';
import { ShieldAlert } from 'lucide-react';
import Link from 'next/link';

export default function Forbidden() {
  return (
    <main className="flex min-h-dvh items-center justify-center px-4">
      <div className="grid max-w-sm justify-items-center gap-4 text-center">
        <ShieldAlert className="size-10 text-destructive" aria-hidden />
        <div className="grid gap-1">
          <p className="font-mono text-muted-foreground text-sm">403</p>
          <h1 className="font-semibold text-2xl tracking-tight">Acesso negado</h1>
          <p className="text-muted-foreground">Você não tem permissão para acessar esta área.</p>
        </div>
        <Button asChild variant="outline">
          <Link href="/app">Voltar ao painel</Link>
        </Button>
      </div>
    </main>
  );
}
