import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: 'Demo FuseAI — app com créditos via Pix',
  description: 'Exemplo mínimo: usuário final compra créditos via Pix e conversa com a IA.',
  manifest: '/manifest.webmanifest',
};

export const viewport: Viewport = { themeColor: '#111014', width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
