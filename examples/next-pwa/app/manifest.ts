import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Demo FuseAI',
    short_name: 'FuseDemo',
    start_url: '/',
    display: 'standalone',
    background_color: '#111014',
    theme_color: '#111014',
    icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' }],
  };
}
