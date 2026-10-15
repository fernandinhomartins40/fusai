'use client';

import { cn } from '@fuseai/ui/lib/utils';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

export function ProjectTabs({ projectId }: { projectId: string }) {
  const pathname = usePathname();
  const base = `/app/projetos/${projectId}`;
  const tabs = [
    { href: base, label: 'Visão geral', exact: true },
    { href: `${base}/chaves`, label: 'Chaves de API' },
    { href: `${base}/usuarios`, label: 'Usuários finais' },
    { href: `${base}/pacotes`, label: 'Pacotes de créditos' },
    { href: `${base}/modelos`, label: 'Modelos permitidos' },
    { href: `${base}/configuracoes`, label: 'Configurações' },
  ];
  return (
    <nav aria-label="Seções do projeto" className="-mx-1 flex gap-1 overflow-x-auto border-b px-1">
      {tabs.map((t) => {
        const active = t.exact ? pathname === t.href : pathname.startsWith(t.href);
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              '-mb-px whitespace-nowrap border-b-2 px-3 py-2.5 text-sm transition-colors',
              active
                ? 'border-fuse-pink font-medium text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
