import { DOC_PAGES, docMarkdown, getDoc } from '@fuseai/docs';
import { DOC_URLS } from '@/lib/docs';

export const dynamicParams = false;
export const generateStaticParams = () => DOC_PAGES.map((p) => ({ slug: p.slug }));

/** Served at /docs/<slug>.md (rewrite in next.config.ts): one page as Markdown. */
export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const page = getDoc((await params).slug);
  if (!page) return new Response('Não encontrado', { status: 404 });
  return new Response(docMarkdown(page, DOC_URLS), {
    headers: { 'content-type': 'text/markdown; charset=utf-8' },
  });
}
