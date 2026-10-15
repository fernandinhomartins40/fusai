'use client';

import { cn } from '@fusai/ui/lib/utils';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

type Item = { slug: string; title: string };

/** Docs sidebar: a list on desktop, a collapsible menu on phones. */
export function DocsNav({ items }: { items: Item[] }) {
  const pathname = usePathname();
  const current = items.find((i) => pathname === `/docs/${i.slug}`);
  const list = (
    <ul className="grid gap-0.5 text-sm">
      {items.map((i) => {
        const active = pathname === `/docs/${i.slug}`;
        return (
          <li key={i.slug}>
            <Link
              href={`/docs/${i.slug}`}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'block rounded-lg px-3 py-2 transition-colors',
                active
                  ? 'bg-accent font-medium text-foreground'
                  : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
              )}
            >
              {i.title}
            </Link>
          </li>
        );
      })}
    </ul>
  );
  return (
    <nav aria-label="Documentação">
      <details className="rounded-xl border md:hidden">
        <summary className="cursor-pointer px-3 py-2.5 font-medium text-sm">
          {current ? current.title : 'Navegar na documentação'}
        </summary>
        <div className="border-t p-2">{list}</div>
      </details>
      <div className="sticky top-20 hidden md:block">{list}</div>
    </nav>
  );
}
