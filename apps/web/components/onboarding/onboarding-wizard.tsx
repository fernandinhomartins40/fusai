'use client';

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@fusai/ui/components/card';
import { cn } from '@fusai/ui/lib/utils';
import { Check } from 'lucide-react';
import { useState } from 'react';
import { KeyStep } from './key-step';
import { OrganizationStep } from './organization-step';
import { ProjectStep } from './project-step';

type Org = { id: string; name: string };

const steps = ['Organização', 'Projeto', 'Chave de API'] as const;

export function OnboardingWizard({
  userName,
  existingOrg,
}: {
  userName: string;
  existingOrg: Org | null;
}) {
  const [org, setOrg] = useState<Org | null>(existingOrg);
  const [project, setProject] = useState<{ id: string; name: string } | null>(null);
  const step = !org ? 0 : !project ? 1 : 2;

  return (
    <div className="mx-auto grid max-w-xl gap-6">
      <div>
        <h1 className="font-semibold text-2xl tracking-tight">Boas-vindas, {userName}!</h1>
        <p className="mt-1 text-muted-foreground">
          Três passos rápidos para começar a usar a fusai.
        </p>
      </div>

      <ol className="flex items-center gap-2" aria-label="Etapas">
        {steps.map((label, i) => (
          <li
            key={label}
            className="flex flex-1 items-center gap-2"
            aria-current={i === step ? 'step' : undefined}
          >
            <span
              className={cn(
                'flex size-7 shrink-0 items-center justify-center rounded-full border font-medium text-xs',
                i < step && 'border-transparent bg-fusai-fill text-white',
                i === step && 'border-foreground',
                i > step && 'text-muted-foreground',
              )}
            >
              {i < step ? <Check className="size-4" aria-hidden /> : i + 1}
            </span>
            <span className={cn('text-sm', i === step ? 'font-medium' : 'text-muted-foreground')}>
              {label}
            </span>
            {i < steps.length - 1 ? <span aria-hidden className="h-px flex-1 bg-border" /> : null}
          </li>
        ))}
      </ol>

      <Card>
        {step === 0 ? (
          <>
            <CardHeader>
              <CardTitle>Sua organização</CardTitle>
              <CardDescription>
                Os dados são usados para emitir as cobranças Pix. Você pode alterá-los depois.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <OrganizationStep onCreated={setOrg} />
            </CardContent>
          </>
        ) : step === 1 && org ? (
          <>
            <CardHeader>
              <CardTitle>Primeiro projeto</CardTitle>
              <CardDescription>
                Um projeto representa um app seu. Cada projeto tem suas chaves de API.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ProjectStep orgId={org.id} onCreated={setProject} />
            </CardContent>
          </>
        ) : project ? (
          <>
            <CardHeader>
              <CardTitle>Sua chave de API</CardTitle>
              <CardDescription>
                Use-a no servidor do seu app para chamar a fusai com o SDK da OpenAI.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <KeyStep projectId={project.id} projectName={project.name} />
            </CardContent>
          </>
        ) : null}
      </Card>
    </div>
  );
}
