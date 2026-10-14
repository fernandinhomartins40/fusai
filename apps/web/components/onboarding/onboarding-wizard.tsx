'use client';

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@fuseai/ui/components/card';
import { cn } from '@fuseai/ui/lib/utils';
import { Check } from 'lucide-react';
import { useState } from 'react';
import { DoneStep } from './done-step';
import { OrganizationStep } from './organization-step';
import { ProjectStep } from './project-step';

type Org = { id: string; name: string };

const steps = ['Organização', 'Projeto', 'Pronto'] as const;

export function OnboardingWizard({
  userName,
  existingOrg,
}: {
  userName: string;
  existingOrg: Org | null;
}) {
  const [org, setOrg] = useState<Org | null>(existingOrg);
  const [projectName, setProjectName] = useState<string | null>(null);
  const step = !org ? 0 : !projectName ? 1 : 2;

  return (
    <div className="mx-auto grid max-w-xl gap-6">
      <div>
        <h1 className="font-semibold text-2xl tracking-tight">Boas-vindas, {userName}!</h1>
        <p className="mt-1 text-muted-foreground">
          Três passos rápidos para começar a usar a FuseAI.
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
                i < step && 'border-transparent bg-fuse-gradient text-white',
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
              <ProjectStep orgId={org.id} onCreated={setProjectName} />
            </CardContent>
          </>
        ) : (
          <CardContent className="pt-6">
            <DoneStep orgName={org?.name ?? ''} projectName={projectName ?? ''} />
          </CardContent>
        )}
      </Card>
    </div>
  );
}
