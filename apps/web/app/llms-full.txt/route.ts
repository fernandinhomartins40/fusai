import { llmsFullTxt } from '@fusai/docs';
import { DOC_URLS } from '@/lib/docs';

export const dynamic = 'force-static';

/** All docs in one plain-text file (PRD §10.3). */
export function GET() {
  return new Response(llmsFullTxt(DOC_URLS), {
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
}
