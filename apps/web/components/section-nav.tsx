'use client';

import { cn } from '@fusai/ui/lib/utils';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';

export type SectionNavItem = { href: string; label: string; exact?: boolean };

/** Horizontal, scrollable tab bar (works at any width, unlike the header nav). */
export function SectionNav({ items, label }: { items: SectionNavItem[]; label: string }) {
  const pathname = usePathname();
  const navRef = useRef<HTMLElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-run when the route changes
  useEffect(() => {
    navRef.current
      ?.querySelector('[aria-current="page"]')
      ?.scrollIntoView({ block: 'nearest', inline: 'center' });
  }, [pathname]);
  return (
    <nav ref={navRef} aria-label={label} className="border-b">
      <div className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-4 sm:px-6">
        {items.map((item) => {
          const active = item.exact ? pathname === item.href : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? 'page' : undefined}
              className={cn(
                '-mb-px whitespace-nowrap border-b-2 px-3 py-3 text-sm transition-colors',
                active
                  ? 'border-fusai-accent font-medium text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              {item.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
