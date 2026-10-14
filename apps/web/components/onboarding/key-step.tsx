'use client';

import { Button } from '@fuseai/ui/components/button';
import { ArrowRight, PartyPopper } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { CreateKeyForm } from '@/components/api-keys/create-key-form';
import { KeyReveal } from '@/components/api-keys/key-reveal';
import type { CreatedApiKey } from '@/lib/api-key-types';

/** Step 3: first API key, shown once, then into the dashboard. */
export function KeyStep({ projectId, projectName }: { projectId: string; projectName: string }) {
  const router = useRouter();
  const [created, setCreated] = useState<CreatedApiKey | null>(null);
  const goToDashboard = () => {
    router.replace(`/app/projetos/${projectId}`);
    router.refresh();
  };

  if (!created) {
    return (
      <div className="grid gap-4">
        <CreateKeyForm projectId={projectId} onCreated={setCreated} defaultName="Produção" />
        <Button variant="ghost" onClick={goToDashboard}>
          Pular por enquanto
        </Button>
      </div>
    );
  }

  return (
    <div className="grid gap-5">
      <div className="flex items-center gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-fuse-gradient text-white">
          <PartyPopper className="size-5" aria-hidden />
        </span>
        <div className="grid">
          <h2 className="font-semibold text-lg">Tudo pronto!</h2>
          <p className="text-muted-foreground text-sm">
            A chave do projeto {projectName} foi criada.
          </p>
        </div>
      </div>
      <KeyReveal created={created} />
      <Button variant="brand" onClick={goToDashboard}>
        Já copiei, ir para o painel <ArrowRight />
      </Button>
    </div>
  );
}
