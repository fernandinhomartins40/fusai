import { llmsTxt } from '@fuseai/docs';
import { DOC_URLS } from '@/lib/docs';

export const dynamic = 'force-static';

/** https://llmstxt.org: index of the docs for AI assistants. */
export function GET() {
  return new Response(llmsTxt(DOC_URLS), {
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
}
