import { safeReturnUrl } from '@fusai/shared';
import { Logo } from '@fusai/ui/components/logo';
import type { Metadata } from 'next';
import { HostedCheckout } from './hosted-checkout';

export const metadata: Metadata = {
  title: 'Pagamento Pix',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

type Props = {
  params: Promise<{ checkoutId: string }>;
  searchParams: Promise<{ return_url?: string | string[] }>;
};

/**
 * Hosted checkout (PRD §9.3): opened by customers' apps (web, PWA, WebView, native in-app
 * browser). Data is fetched by the browser itself, so the per-IP rate limit is per buyer.
 */
export default async function PayPage({ params, searchParams }: Props) {
  const { checkoutId } = await params;
  const raw = (await searchParams).return_url;
  const returnUrl = safeReturnUrl(Array.isArray(raw) ? raw[0] : raw);

  return (
    <main className="mx-auto grid min-h-dvh w-full max-w-md content-start gap-6 px-4 py-8 sm:py-12">
      <HostedCheckout checkoutId={checkoutId} returnUrlOverride={returnUrl} />
      <footer className="flex items-center justify-center gap-2 text-muted-foreground text-xs">
        Pagamento processado com segurança por <Logo className="h-5" />
      </footer>
    </main>
  );
}
