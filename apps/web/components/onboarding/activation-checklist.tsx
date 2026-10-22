import { Button } from '@fusai/ui/components/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@fusai/ui/components/card';
import { cn } from '@fusai/ui/lib/utils';
import { ArrowRight, CheckCircle2, Circle } from 'lucide-react';
import Link from 'next/link';
import type { Overview } from '@/lib/dashboard-types';

type Step = { label: string; done: boolean; cta: string; href: string };

/** "Primeiros passos" on the home page; disappears once every step is done (O-02). */
export function ActivationChecklist({ activation }: { activation: Overview['activation'] }) {
  const project = activation.projectId ? `/app/projetos/${activation.projectId}` : '/app/projetos';
  const steps: Step[] = [
    { label: 'Criar a conta', done: true, cta: '', href: '' },
    {
      label: 'Criar um projeto',
      done: activation.hasProject,
      cta: 'Criar projeto',
      href: '/app/projetos',
    },
    {
      label: 'Gerar uma chave de API',
      done: activation.hasKey,
      cta: 'Gerar chave',
      href: `${project}/chaves`,
    },
    {
      label: 'Adicionar créditos',
      done: activation.hasCredits,
      cta: 'Adicionar créditos',
      href: '/app/carteira?recarga=1',
    },
    {
      label: 'Fazer a primeira chamada',
      done: activation.hasFirstCall,
      cta: 'Abrir o Kit de Integração',
      href: `${project}/integracao`,
    },
  ];
  const next = steps.find((s) => !s.done);
  if (!next) return null;
  const doneCount = steps.filter((s) => s.done).length;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Primeiros passos</CardTitle>
        <CardDescription>
          {doneCount} de {steps.length} concluídos. Falta pouco para seus apps usarem a IA.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <ol className="grid gap-2 text-sm">
          {steps.map((s) => (
            <li key={s.label} className="flex items-center gap-2">
              {s.done ? (
                <CheckCircle2 className="size-4 shrink-0 text-success-foreground" aria-hidden />
              ) : (
                <Circle className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              )}
              <span className={cn(s.done && 'text-muted-foreground line-through')}>
                {s.label}
                <span className="sr-only">{s.done ? ' (concluído)' : ' (pendente)'}</span>
              </span>
            </li>
          ))}
        </ol>
        <div>
          <Button asChild variant="brand">
            <Link href={next.href}>
              {next.cta} <ArrowRight />
            </Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
