import { mcpSnippets, SUGGESTED_PROMPT } from '@fusai/docs/kit';
import { Button } from '@fusai/ui/components/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@fusai/ui/components/card';
import { BookOpen, KeyRound } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { CodeBlock } from '@/components/copy-button';
import { DownloadFusaiMd } from '@/components/integration/download-fusai-md';
import { McpCommands } from '@/components/integration/mcp-commands';
import { API_URL } from '@/lib/config';
import type { ProjectDetail } from '@/lib/dashboard-types';
import { serverApi } from '@/lib/session';

export const metadata: Metadata = { title: 'Kit de Integração' };

const KEY_PLACEHOLDER = 'fai_live_SUA_CHAVE';

/** PRD §10.2: everything the customer's coding AI needs to integrate fusai on its own. */
export default async function IntegrationKitPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { data: project } = await serverApi<ProjectDetail>(`/internal/projects/${id}`);
  if (!project) notFound();
  const snippets = mcpSnippets(API_URL, KEY_PLACEHOLDER);

  return (
    <div className="grid gap-6">
      <div className="grid gap-1">
        <h2 className="font-semibold text-lg">Kit de Integração</h2>
        <p className="text-muted-foreground text-sm">
          Conecte a fusai à sua IA de programação (Claude Code, Cursor, VS Code…) e deixe ela fazer
          a integração. Troque <code className="font-mono">{KEY_PLACEHOLDER}</code> por uma chave
          deste projeto: ela aparece completa só ao ser criada.
        </p>
        <Button asChild variant="outline" size="sm" className="mt-2 w-fit">
          <Link href={`/app/projetos/${id}/chaves`}>
            <KeyRound /> Gerar chave
          </Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">1. Conecte o MCP</CardTitle>
          <CardDescription>
            Servidor remoto <code className="font-mono">{API_URL}/mcp</code> (Streamable HTTP). A
            chave precisa do escopo <code className="font-mono">mcp</code>.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <McpCommands apiKey={KEY_PLACEHOLDER} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">2. Variáveis de ambiente do servidor</CardTitle>
          <CardDescription>
            A chave fica só no backend, nunca no front-end ou no app.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <CodeBlock label=".env" code={snippets.env} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">3. Instruções para a IA</CardTitle>
          <CardDescription>
            Coloque o FUSAI.md na raiz do seu projeto. Ele é gerado com os dados atuais de “
            {project.name}” (modo de cobrança, modelos, pacotes, origens e webhook), sem a chave.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <DownloadFusaiMd projectId={id} />
          <CodeBlock label="Prompt sugerido" code={SUGGESTED_PROMPT} wrap />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Já usa a OpenAI?</CardTitle>
          <CardDescription>Troque só a chave e a URL base no SDK oficial.</CardDescription>
        </CardHeader>
        <CardContent>
          <CodeBlock
            label="Node.js"
            code={`const client = new OpenAI({
-  apiKey: process.env.OPENAI_API_KEY,
+  apiKey: process.env.FUSAI_API_KEY,
+  baseURL: '${API_URL}/v1',
});`}
          />
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
