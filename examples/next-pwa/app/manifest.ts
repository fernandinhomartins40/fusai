import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Demo fusai',
    short_name: 'FuseDemo',
    start_url: '/',
    display: 'standalone',
    background_color: '#0a0e1a',
    theme_color: '#0a0e1a',
    icons: [{ src: '/icone-fusai.png', sizes: '512x512', type: 'image/png' }],
  };
}
