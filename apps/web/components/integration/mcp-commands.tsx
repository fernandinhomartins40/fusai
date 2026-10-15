'use client';

import { mcpSnippets } from '@fusai/docs/kit';
import { cn } from '@fusai/ui/lib/utils';
import { useState } from 'react';
import { CodeBlock } from '@/components/copy-button';
import { API_URL } from '@/lib/config';

const CLIENTS = [
  { id: 'claude', label: 'Claude Code' },
  { id: 'cursor', label: 'Cursor / Claude Desktop' },
  { id: 'vscode', label: 'VS Code' },
] as const;

/** MCP connection commands for the main coding AIs, with the key (or a placeholder). */
export function McpCommands({ apiKey }: { apiKey: string }) {
  const [client, setClient] = useState<(typeof CLIENTS)[number]['id']>('claude');
  const s = mcpSnippets(API_URL, apiKey);
  return (
    <div className="grid gap-3">
      <div role="tablist" aria-label="Cliente MCP" className="flex flex-wrap gap-1">
        {CLIENTS.map((c) => (
          <button
            key={c.id}
            type="button"
            role="tab"
            aria-selected={client === c.id}
            onClick={() => setClient(c.id)}
            className={cn(
              'rounded-lg px-3 py-1.5 text-sm transition-colors',
              client === c.id
                ? 'bg-accent font-medium text-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {c.label}
          </button>
        ))}
      </div>
      {client === 'claude' ? (
        <CodeBlock label="Terminal" code={s.claudeCode} />
      ) : client === 'cursor' ? (
        <CodeBlock label=".cursor/mcp.json · claude_desktop_config.json" code={s.mcpServersJson} />
      ) : (
        <CodeBlock label=".vscode/mcp.json" code={s.vscodeJson} />
      )}
    </div>
  );
}
