import { DOC_PAGES } from '@fusai/docs';
import type { MetadataRoute } from 'next';
import { APP_URL } from '@/lib/config';

const SITE_URL = (process.env.APP_URL ?? APP_URL).replace(/\/+$/, '');

/** Public pages only: the panel, admin and checkout are not indexed. */
export default function sitemap(): MetadataRoute.Sitemap {
  const pages = ['', '/modelos', '/precos', '/docs', '/termos', '/privacidade'];
  return [
    ...pages.map((path) => ({
      url: `${SITE_URL}${path}`,
      changeFrequency: 'weekly' as const,
      priority: path === '' ? 1 : 0.7,
    })),
    ...DOC_PAGES.map((p) => ({
      url: `${SITE_URL}/docs/${p.slug}`,
      changeFrequency: 'weekly' as const,
      priority: 0.6,
    })),
  ];
}
