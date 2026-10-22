'use client';

import { Button } from '@fusai/ui/components/button';
import { ArrowRight, PartyPopper } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { CreateKeyForm } from '@/components/api-keys/create-key-form';
import { KeyReveal } from '@/components/api-keys/key-reveal';
import type { CreatedApiKey } from '@/lib/api-key-types';

/** Step 3: first API key, shown once, then into the project's Integration Kit (PRD §11.3). */
export function KeyStep({ projectId, projectName }: { projectId: string; projectName: string }) {
  const router = useRouter();
  const [created, setCreated] = useState<CreatedApiKey | null>(null);
  const goTo = (path: string) => {
    router.replace(`/app/projetos/${projectId}/${path}`);
    router.refresh();
  };
  const goToDashboard = () => goTo('chaves');

  if (!created) {
    return (
      <div className="grid gap-4">
        <CreateKeyForm
          projectId={projectId}
          onCreated={setCreated}
          defaultName="Produção"
          defaultScopes={['chat', 'mcp']}
        />
        <Button variant="ghost" onClick={goToDashboard}>
          Pular por enquanto
        </Button>
      </div>
    );
  }

  return (
    <div className="grid gap-5">
      <div className="flex items-center gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-fusai-fill text-white">
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
      <Button variant="brand" onClick={() => goTo('integracao')}>
        Já copiei, ver o Kit de Integração <ArrowRight />
      </Button>
    </div>
  );
}
