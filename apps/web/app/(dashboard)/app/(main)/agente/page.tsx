import { AGENT_PROMPTS } from '@fusai/docs/kit';
import { Button } from '@fusai/ui/components/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@fusai/ui/components/card';
import { BookOpen, Building2, ShoppingCart, UserRound } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { type AgentKeyInfo, AgentKeysPanel } from '@/components/agent/agent-keys-panel';
import { CodeBlock } from '@/components/copy-button';
import { API_URL } from '@/lib/config';
import { getCurrentOrg } from '@/lib/current-org';
import { getMe, serverApi } from '@/lib/session';

export const metadata: Metadata = { title: 'Agente de IA' };

const CASES = [
  {
    icon: UserRound,
    title: 'Uso próprio',
    text: 'Você usa IA no seu sistema e paga o consumo. A IA cria o projeto, a chave, implementa as chamadas e gera o Pix de recarga.',
  },
  {
    icon: ShoppingCart,
    title: 'Revenda',
    text: 'Seus clientes compram créditos com Pix dentro do seu sistema, veem o saldo e usam a IA. A IA cria pacotes, configura o webhook e implementa a compra.',
  },
  {
    icon: Building2,
    title: 'Híbrido',
    text: 'Grátis até acabar o saldo do usuário; depois a sua organização paga. Bom para plano gratuito com compra opcional.',
  },
];

/** Organization agent MCP (D-123): the customer's coding AI configures everything. */
export default async function AgentPage() {
  const org = await getCurrentOrg(await getMe());
  if (!org) return null;
  const canManage = org.role === 'OWNER' || org.role === 'ADMIN';
  const { data } = canManage
    ? await serverApi<{ keys: AgentKeyInfo[] }>(`/internal/organizations/${org.id}/agent-keys`)
    : { data: null };

  return (
    <div className="grid gap-6">
      <div className="grid gap-1">
        <h1 className="font-semibold text-2xl tracking-tight">Agente de IA</h1>
        <p className="text-muted-foreground text-sm">
          Conecte o Claude Code, Cursor, VS Code ou Claude Desktop à fusai e peça para a IA
          configurar tudo: projetos, chaves, pacotes de créditos, Pix e o código do seu sistema.
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        {CASES.map((c) => (
          <Card key={c.title}>
            <CardContent className="grid gap-2 p-5">
              <c.icon className="size-5 text-fusai-accent" aria-hidden />
              <span className="font-medium">{c.title}</span>
              <span className="text-muted-foreground text-sm">{c.text}</span>
            </CardContent>
          </Card>
        ))}
      </div>

      {canManage ? (
        <AgentKeysPanel orgId={org.id} keys={data?.keys ?? []} />
      ) : (
        <Card>
          <CardContent className="p-5 text-muted-foreground text-sm">
            Só donos e admins da organização criam chaves de agente. Peça a um deles.
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">O que pedir para a sua IA</CardTitle>
          <CardDescription>
            Com o MCP conectado (servidor <code className="font-mono">{API_URL}/mcp</code>), abra o
            projeto do seu sistema na IA e peça:
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          {AGENT_PROMPTS.map((p) => (
            <CodeBlock key={p.title} label={p.title} code={p.prompt} wrap />
          ))}
        </CardContent>
      </Card>

      <Button asChild variant="ghost" className="w-fit">
        <Link href="/docs/mcp">
          <BookOpen /> Docs do MCP
        </Link>
      </Button>
    </div>
  );
}
