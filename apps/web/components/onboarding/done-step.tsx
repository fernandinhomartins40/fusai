'use client';

import { Button } from '@fuseai/ui/components/button';
import { ArrowRight, PartyPopper } from 'lucide-react';
import { useRouter } from 'next/navigation';

export function DoneStep({ orgName, projectName }: { orgName: string; projectName: string }) {
  const router = useRouter();
  return (
    <div className="grid justify-items-center gap-4 py-4 text-center">
      <span className="flex size-12 items-center justify-center rounded-full bg-fuse-gradient text-white">
        <PartyPopper className="size-6" aria-hidden />
      </span>
      <div className="grid gap-1">
        <h2 className="font-semibold text-xl">Tudo pronto!</h2>
        <p className="text-muted-foreground text-sm">
          {orgName} e o projeto {projectName} foram criados. Próximo passo: gerar sua chave de API e
          conectar o Kit de Integração.
        </p>
      </div>
      <Button
        variant="brand"
        onClick={() => {
          router.replace('/app');
          router.refresh();
        }}
      >
        Ir para o painel <ArrowRight />
      </Button>
    </div>
  );
}
