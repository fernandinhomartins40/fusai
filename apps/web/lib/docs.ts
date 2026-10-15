import 'server-only';
import { DOC_PAGES, type DocPage, renderDoc } from '@fusai/docs';
import { Marked } from 'marked';
import { API_URL, APP_URL } from './config';

export const DOC_URLS = { api: API_URL, app: APP_URL };

const slugify = (text: string) =>
  text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

const marked = new Marked({
  gfm: true,
  renderer: {
    // h2/h3 get ids so sections can be linked (#webhooks).
    heading({ tokens, depth }) {
      const html = this.parser.parseInline(tokens);
      return `<h${depth} id="${slugify(html)}">${html}</h${depth}>\n`;
    },
  },
});

/** Docs are our own Markdown (packages/docs/content): trusted, rendered on the server. */
export function docHtml(page: DocPage): string {
  return marked.parse(renderDoc(page.body, DOC_URLS), { async: false });
}

export function docNeighbors(slug: string) {
  const i = DOC_PAGES.findIndex((p) => p.slug === slug);
  return { prev: DOC_PAGES[i - 1] ?? null, next: DOC_PAGES[i + 1] ?? null };
}
