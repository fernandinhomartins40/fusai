import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@fusai/ui/components/card';
import { CheckCircle2, CircleAlert } from 'lucide-react';
import Link from 'next/link';
import type { AdminReadiness } from '@/lib/admin-types';

/** "Pronto para vender": what is still missing before customers can buy and use the AI (O-10). */
export function ReadinessChecklist({ readiness }: { readiness: AdminReadiness }) {
  if (readiness.ready) return null;
  const pending = readiness.checks.filter((c) => !c.ok).length;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Pronto para vender?</CardTitle>
        <CardDescription>
          {pending === 1 ? 'Falta 1 item' : `Faltam ${pending} itens`} para os clientes comprarem
          créditos e usarem a IA.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="grid gap-2 text-sm">
          {readiness.checks.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
              {c.ok ? (
                <CheckCircle2 className="size-4 shrink-0 text-success-foreground" aria-hidden />
              ) : (
                <CircleAlert className="size-4 shrink-0 text-warning-foreground" aria-hidden />
              )}
              <span className="font-medium">
                {c.label}
                <span className="sr-only">{c.ok ? ' (ok)' : ' (pendente)'}</span>
              </span>
              <span className="text-muted-foreground">
                {!c.ok && c.href ? (
                  <Link href={c.href} className="underline underline-offset-4">
                    {c.detail}
                  </Link>
                ) : (
                  c.detail
                )}
              </span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
