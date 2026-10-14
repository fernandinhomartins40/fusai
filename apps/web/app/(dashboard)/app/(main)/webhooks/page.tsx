import { Badge } from '@fuseai/ui/components/badge';
import { Button } from '@fuseai/ui/components/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@fuseai/ui/components/card';
import { Settings } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getCurrentOrg } from '@/lib/current-org';
import type { ProjectDetail } from '@/lib/dashboard-types';
import { getMe, serverApi } from '@/lib/session';

export const metadata: Metadata = { title: 'Webhooks' };

const EVENTS = [
  ['payment.received', 'Pagamento Pix confirmado'],
  ['payment.expired', 'Cobrança Pix expirou'],
  ['payment.refunded', 'Pagamento estornado'],
  ['app_user.credited', 'Créditos adicionados a um usuário final'],
  ['balance.low', 'Saldo abaixo do alerta'],
  ['usage.limit_reached', 'Limite de gasto de uma chave atingido'],
] as const;

export default async function WebhooksPage() {
  const org = await getCurrentOrg(await getMe());
  if (!org) return null;
  const projects = (
    await Promise.all(
      org.projects.map((p) =>
        serverApi<ProjectDetail & { hasWebhookSecret: boolean }>(`/internal/projects/${p.id}`),
      ),
    )
  ).flatMap((r) => (r.data ? [r.data] : []));

  return (
    <div className="grid gap-6">
      <div className="grid gap-1">
        <h1 className="font-semibold text-2xl tracking-tight">Webhooks</h1>
        <p className="text-muted-foreground text-sm">
          A FuseAI avisa seu servidor sobre pagamentos e saldo. Configure por projeto.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {projects.map((p) => (
          <Card key={p.id}>
            <CardHeader>
              <div className="flex items-start justify-between gap-2">
                <CardTitle className="text-base">{p.name}</CardTitle>
                {p.webhookUrl ? (
                  <Badge variant="success">ativo</Badge>
                ) : (
                  <Badge variant="secondary">desligado</Badge>
                )}
              </div>
              <CardDescription className="truncate font-mono text-xs">
                {p.webhookUrl ?? 'Nenhuma URL configurada'}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-muted-foreground text-xs">
                {p.hasWebhookSecret
                  ? 'Segredo de assinatura configurado'
                  : 'Sem segredo de assinatura'}
              </span>
              <Button asChild variant="outline" size="sm">
                <Link href={`/app/projetos/${p.id}/configuracoes`}>
                  <Settings /> Configurar
                </Link>
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Eventos</CardTitle>
          <CardDescription>
            Enviados por POST em JSON, assinados com HMAC-SHA256, com novas tentativas automáticas
            em caso de falha.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="grid gap-2 text-sm">
            {EVENTS.map(([name, label]) => (
              <li key={name} className="flex flex-wrap items-center justify-between gap-2">
                <code className="font-mono text-xs">{name}</code>
                <span className="text-muted-foreground">{label}</span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Histórico de entregas</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="py-6 text-center text-muted-foreground text-sm">
            Nenhuma entrega ainda. As notificações aparecerão aqui, com opção de reenviar.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
