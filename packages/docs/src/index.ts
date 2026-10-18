import { DOC_PAGES } from './content.generated';
import type { DocPage, DocUrls } from './types';

export * from './agent';
export * from './guide';
export * from './kit';
export type { DocPage, DocUrls };
export { DOC_PAGES };

/** Replaces {{API}}, {{V1}}, {{MCP}} and {{APP}} with this deployment's URLs. */
export function renderDoc(markdown: string, urls: DocUrls): string {
  const api = urls.api.replace(/\/+$/, '');
  const app = urls.app.replace(/\/+$/, '');
  return markdown
    .replaceAll('{{V1}}', `${api}/v1`)
    .replaceAll('{{MCP}}', `${api}/mcp`)
    .replaceAll('{{API}}', api)
    .replaceAll('{{APP}}', app);
}

export function getDoc(slug: string): DocPage | undefined {
  return DOC_PAGES.find((p) => p.slug === slug);
}

/** One page as standalone Markdown (title + description + body), URLs rendered. */
export function docMarkdown(page: DocPage, urls: DocUrls): string {
  return renderDoc(`# ${page.title}\n\n> ${page.description}\n\n${page.body}`, urls);
}

/** `/llms.txt` (https://llmstxt.org): index of the docs with links to plain-text versions. */
export function llmsTxt(urls: DocUrls): string {
  const app = urls.app.replace(/\/+$/, '');
  const lines = [
    '# fusai',
    '',
    '> Gateway de IA compatível com a API da OpenAI, voltado ao Brasil: vários modelos (DeepSeek, Kimi, GLM, Qwen, MiniMax) com uma chave, créditos pré-pagos em reais, recarga via Pix e cobrança dos usuários finais do seu app via Pix.',
    '',
    `Base URL da API: ${urls.api.replace(/\/+$/, '')}/v1 · Servidor MCP: ${urls.api.replace(/\/+$/, '')}/mcp`,
    '',
    '## Docs',
    '',
    ...DOC_PAGES.map((p) => `- [${p.title}](${app}/docs/${p.slug}.md): ${p.description}`),
    '',
    '## Optional',
    '',
    `- [Docs completas em um arquivo](${app}/llms-full.txt)`,
  ];
  return `${lines.join('\n')}\n`;
}

/** `/llms-full.txt`: every page concatenated. */
export function llmsFullTxt(urls: DocUrls): string {
  return DOC_PAGES.map((p) => docMarkdown(p, urls)).join('\n\n---\n\n');
}

/** Bundles for the MCP resources fusai://docs/{api,sdk,checkout}. */
export const DOC_BUNDLES = {
  api: ['inicio-rapido', 'autenticacao', 'chat', 'modelos', 'erros', 'limites'],
  sdk: ['sdks', 'usuarios-finais'],
  checkout: ['creditos-da-conta', 'usuarios-finais', 'checkout-pix', 'webhooks'],
} as const;

export function docBundle(name: keyof typeof DOC_BUNDLES, urls: DocUrls): string {
  return DOC_BUNDLES[name]
    .map((slug) => getDoc(slug))
    .filter((p): p is DocPage => !!p)
    .map((p) => docMarkdown(p, urls))
    .join('\n\n---\n\n');
}
