import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain ESM script without types
import { buildContent } from '../scripts/generate.mjs';
import {
  DOC_PAGES,
  fusaiMd,
  integrationGuide,
  llmsTxt,
  type ProjectSnapshot,
  renderDoc,
} from './index';

const urls = { api: 'https://api.fusai.com.br', app: 'https://www.fusai.com.br' };
const project: ProjectSnapshot = {
  name: 'Meu App',
  billingMode: 'END_USER_WALLET',
  allowedOrigins: ['https://meuapp.com'],
  webhookUrl: null,
  freeCreditMicros: '500000',
  defaultModel: 'fuse/deepseek-chat',
  models: [
    { id: 'fuse/deepseek-chat', name: 'DeepSeek Chat', input: '1.540000', output: '6.160000' },
    { id: 'fuse/mini', name: 'Mini', input: '0.154000', output: '12.000000' },
  ],
  packages: [
    {
      id: 'pkg_1',
      name: '100 mensagens',
      priceCents: 990,
      creditMicros: '9000000',
      bonusMicros: '1000000',
    },
  ],
};

describe('docs content', () => {
  it('content.generated.ts is in sync with content/*.md (run `pnpm --filter @fusai/docs generate`)', () => {
    const current = readFileSync(new URL('./content.generated.ts', import.meta.url), 'utf8');
    expect(current).toBe(buildContent());
  });

  it('has the 11 pages of PRD §10.3 and renders every placeholder', () => {
    expect(DOC_PAGES.map((p) => p.slug)).toEqual([
      'inicio-rapido',
      'autenticacao',
      'chat',
      'modelos',
      'usuarios-finais',
      'checkout-pix',
      'webhooks',
      'mcp',
      'sdks',
      'erros',
      'limites',
    ]);
    for (const p of DOC_PAGES) expect(renderDoc(p.body, urls)).not.toMatch(/\{\{[A-Z0-9]+\}\}/);
    expect(renderDoc('{{V1}} {{MCP}}', urls)).toBe(
      'https://api.fusai.com.br/v1 https://api.fusai.com.br/mcp',
    );
  });

  it('llms.txt follows the llmstxt.org shape', () => {
    const txt = llmsTxt(urls);
    expect(txt.startsWith('# fusai\n\n> ')).toBe(true);
    expect(txt).toContain('- [Checkout Pix](https://www.fusai.com.br/docs/checkout-pix.md):');
  });
});

describe('integration guide', () => {
  it('is personalized for the project and never contains a key', () => {
    const guide = integrationGuide(project, urls, 'flutter');
    expect(guide).toContain('# Integração fusai — Meu App');
    expect(guide).toContain('`https://api.fusai.com.br/v1`');
    expect(guide).toContain('| `fuse/deepseek-chat` | DeepSeek Chat | R$ 1,54 | R$ 6,16 |');
    expect(guide).toContain('| `fuse/mini` | Mini | R$ 0,154 | R$ 12,00 |');
    expect(guide).toContain('**100 mensagens**, R$ 9,90 → R$ 10,00 em créditos');
    expect(guide).toContain("'packageId': 'pkg_1'");
    // biome-ignore lint/suspicious/noTemplateCurlyInString: literal Dart interpolation in the snippet
    expect(guide).toContain('Bearer ${await sessionToken()}');
    expect(guide).not.toMatch(/fai_live_[A-Za-z0-9]{10}/);
  });

  it('each stack produces code; ORG_WALLET guides keep the key on the server', () => {
    for (const stack of [
      'nextjs',
      'react-native',
      'flutter',
      'node',
      'python',
      'laravel',
    ] as const) {
      expect(integrationGuide(project, urls, stack)).toContain('```');
    }
    const org = integrationGuide({ ...project, billingMode: 'ORG_WALLET' }, urls);
    expect(org).toContain('app/api/chat/route.ts');
    expect(org).not.toContain('fuse-session');
  });

  it('FUSAI.md has rules, endpoints, webhooks and checklist', () => {
    const md = fusaiMd(project, urls);
    for (const part of [
      '## Regras',
      '## Endpoints',
      '## Webhooks',
      '## Checklist de testes',
      'get_integration_guide',
    ]) {
      expect(md).toContain(part);
    }
  });
});
