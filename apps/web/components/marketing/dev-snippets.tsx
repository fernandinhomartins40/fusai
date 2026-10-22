'use client';

import { cn } from '@fusai/ui/lib/utils';
import { useState } from 'react';
import { CodeBlock } from '@/components/copy-button';
import { McpCommands } from '@/components/integration/mcp-commands';
import { API_URL } from '@/lib/config';

const KEY = 'fai_live_SUA_CHAVE';

const SNIPPETS = {
  curl: {
    label: 'curl',
    code: `curl ${API_URL}/v1/chat/completions \\
  -H "Authorization: Bearer ${KEY}" \\
  -H "Content-Type: application/json" \\
  -d '{"model": "fuse/auto", "messages": [{"role": "user", "content": "Olá!"}]}'`,
  },
  ts: {
    label: 'TypeScript',
    code: `import OpenAI from 'openai';

const client = new OpenAI({ baseURL: '${API_URL}/v1', apiKey: process.env.FUSAI_API_KEY });

const stream = await client.chat.completions.create({
  model: 'fuse/auto',
  messages: [{ role: 'user', content: 'Olá!' }],
  stream: true,
});
for await (const chunk of stream) process.stdout.write(chunk.choices[0]?.delta?.content ?? '');`,
  },
  python: {
    label: 'Python',
    code: `from openai import OpenAI
import os

client = OpenAI(base_url="${API_URL}/v1", api_key=os.environ["FUSAI_API_KEY"])

res = client.chat.completions.create(
    model="fuse/auto",
    messages=[{"role": "user", "content": "Olá!"}],
)
print(res.choices[0].message.content)`,
  },
} as const;

type Lang = keyof typeof SNIPPETS;

/** "Para devs": the same call in curl/TS/Python, plus the MCP command for coding AIs. */
export function DevSnippets() {
  const [lang, setLang] = useState<Lang>('ts');
  const snippet = SNIPPETS[lang];
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="grid content-start gap-3">
        <h3 className="font-medium">Chamada à API</h3>
        <fieldset aria-label="Linguagem" className="flex flex-wrap gap-1">
          {(Object.keys(SNIPPETS) as Lang[]).map((key) => (
            <button
              key={key}
              type="button"
              aria-pressed={lang === key}
              onClick={() => setLang(key)}
              className={cn(
                'rounded-lg px-3 py-1.5 text-sm transition-colors',
                lang === key
                  ? 'bg-accent font-medium text-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {SNIPPETS[key].label}
            </button>
          ))}
        </fieldset>
        <CodeBlock code={snippet.code} label={snippet.label} />
      </div>
      <div className="grid content-start gap-3">
        <h3 className="font-medium">Conecte sua IA de programação (MCP)</h3>
        <p className="text-muted-foreground text-sm">
          Com o MCP, o Claude Code ou o Cursor leem a documentação e o seu projeto e fazem a
          integração por você. Troque <code className="font-mono">{KEY}</code> pela sua chave.
        </p>
        <McpCommands apiKey={KEY} />
      </div>
    </div>
  );
}
