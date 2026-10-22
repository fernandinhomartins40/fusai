import { SUGGESTED_PROMPT } from '@fusai/docs/kit';
import { AlertTriangle } from 'lucide-react';
import { CodeBlock, CopyButton } from '@/components/copy-button';
import { McpCommands } from '@/components/integration/mcp-commands';
import type { CreatedApiKey } from '@/lib/api-key-types';
import { API_URL } from '@/lib/config';

/** Shows a freshly created key once, with ready-to-paste snippets. */
export function KeyReveal({ created }: { created: CreatedApiKey }) {
  const baseUrl = `${API_URL}/v1`;
  return (
    <div className="grid gap-4">
      <div className="flex gap-2 rounded-xl border border-warning/40 bg-warning/10 p-3 text-sm">
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning-foreground" aria-hidden />
        <p>
          Copie a chave agora: por segurança ela <strong>não será exibida de novo</strong>. Use-a só
          no servidor, nunca no front-end ou no app.
        </p>
      </div>
      <div className="grid gap-2">
        <span className="font-medium text-sm">Chave “{created.name}”</span>
        <div className="flex items-center gap-2">
          <code className="min-w-0 flex-1 truncate rounded-xl border bg-muted/40 px-3 py-2 font-mono text-xs">
            {created.key}
          </code>
          <CopyButton value={created.key} />
        </div>
      </div>
      <CodeBlock label=".env" code={`FUSAI_API_KEY=${created.key}\nFUSAI_BASE_URL=${baseUrl}`} />
      {created.scopes.includes('mcp') ? (
        <div className="grid gap-2">
          <span className="font-medium text-sm">Conecte sua IA de programação (MCP)</span>
          <McpCommands apiKey={created.key} />
          <p className="text-muted-foreground text-xs">
            Depois peça: “{SUGGESTED_PROMPT}” O FUSAI.md fica no Kit de Integração do projeto.
          </p>
        </div>
      ) : (
        <p className="text-muted-foreground text-xs">
          Para conectar sua IA de programação (MCP), crie uma chave marcando “MCP” em Avançado.
        </p>
      )}
      <CodeBlock
        label="SDK oficial da OpenAI (Node)"
        code={`import OpenAI from 'openai';

const client = new OpenAI({
  apiKey: process.env.FUSAI_API_KEY,
  baseURL: process.env.FUSAI_BASE_URL,
});

const res = await client.chat.completions.create({
  model: 'fuse/auto',
  messages: [{ role: 'user', content: 'Olá!' }],
});`}
      />
    </div>
  );
}
