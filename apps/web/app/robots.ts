import type { MetadataRoute } from 'next';
import { APP_URL } from '@/lib/config';

const SITE_URL = (process.env.APP_URL ?? APP_URL).replace(/\/+$/, '');

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      // Logged-in areas and per-payment pages have nothing to index.
      disallow: [
        '/app',
        '/admin',
        '/pay/',
        '/api/',
        '/seguranca',
        '/convite',
        '/redefinir-senha',
        '/verificar-email',
      ],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
