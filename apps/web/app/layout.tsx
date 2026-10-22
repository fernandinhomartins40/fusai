import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
import type { ReactNode } from 'react';
import { ConfirmHost } from '@/components/confirm';
import { ThemeProvider } from '@/components/theme-provider';
import { Toaster } from '@/components/toaster';
import './globals.css';

/*
 * Geist (OFL, from the `geist` package) subset to Latin + the few symbols the UI uses
 * (→ … — • “ ” ≤ ≥ ✓). About 60% smaller than the full variable fonts, which mattered for the
 * mobile LCP. Regenerate with pyftsubset if the UI starts using other scripts; see fonts/README.
 */
const geistSans = localFont({
  src: './fonts/geist-sans-latin.woff2',
  variable: '--font-geist-sans',
  weight: '100 900',
  display: 'swap',
});
const geistMono = localFont({
  src: './fonts/geist-mono-latin.woff2',
  variable: '--font-geist-mono',
  weight: '100 900',
  display: 'swap',
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.APP_URL ?? 'http://localhost:3000'),
  title: {
    default: 'fusai — Uma API. Os melhores modelos de IA. Pague com Pix.',
    template: '%s · fusai',
  },
  description:
    'Gateway de IA compatível com OpenAI, com os melhores modelos a preço baixo, créditos pré-pagos e recarga via Pix.',
};

export const viewport: Viewport = {
  // Lets the mobile bottom bar use env(safe-area-inset-bottom) (iPhone home indicator).
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: dark)', color: '#0a0e1a' },
    { media: '(prefers-color-scheme: light)', color: '#fbfcfe' },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="pt-BR"
      className={`${geistSans.variable} ${geistMono.variable}`}
      suppressHydrationWarning
    >
      <body className="min-h-dvh">
        <ThemeProvider>
          {children}
          <Toaster />
          <ConfirmHost />
        </ThemeProvider>
      </body>
    </html>
  );
}
