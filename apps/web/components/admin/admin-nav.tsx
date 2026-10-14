'use client';

import { cn } from '@fuseai/ui/lib/utils';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const items = [
  { href: '/admin', label: 'Visão geral', exact: true },
  { href: '/admin/provedores', label: 'Provedores' },
  { href: '/admin/modelos', label: 'Modelos' },
  { href: '/admin/precos', label: 'Preços' },
];

export function AdminNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Seções do admin" className="border-b">
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
                  ? 'border-fuse-pink font-medium text-foreground'
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
