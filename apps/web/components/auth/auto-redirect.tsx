'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

/** Visible countdown, then navigates (the button next to it lets the user go right away). */
export function AutoRedirect({ href, seconds = 4 }: { href: string; seconds?: number }) {
  const router = useRouter();
  const [left, setLeft] = useState(seconds);
  useEffect(() => {
    if (left <= 0) {
      router.replace(href);
      return;
    }
    const t = setTimeout(() => setLeft((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [left, href, router]);
  return (
    <p className="text-muted-foreground text-xs" aria-live="polite">
      {left > 0 ? `Abrindo o painel em ${left}s…` : 'Abrindo o painel…'}
    </p>
  );
}
