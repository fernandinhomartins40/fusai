'use client';

import { cn } from '@fusai/ui/lib/utils';
import {
  Activity,
  BarChart3,
  BookOpen,
  FolderKanban,
  LayoutDashboard,
  Settings,
  Users,
  Wallet,
  Webhook,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { SectionNav, type SectionNavItem } from './section-nav';

const items = [
  { href: '/app', label: 'Visão geral', icon: LayoutDashboard, exact: true },
  { href: '/app/projetos', label: 'Projetos', icon: FolderKanban },
  { href: '/app/carteira', label: 'Carteira', icon: Wallet },
  { href: '/app/consumo', label: 'Consumo', icon: BarChart3 },
  { href: '/app/logs', label: 'Logs', icon: Activity },
  { href: '/app/webhooks', label: 'Webhooks', icon: Webhook },
  { href: '/app/equipe', label: 'Equipe', icon: Users },
  { href: '/app/configuracoes', label: 'Configurações', icon: Settings },
  { href: '/docs', label: 'Docs', icon: BookOpen },
];

/** Desktop sidebar (PRD §11.4). */
export function AppSidebar() {
  const pathname = usePathname();
  return (
    <nav aria-label="Painel" className="grid gap-0.5">
      {items.map(({ href, label, icon: Icon, exact }) => {
        const active = exact ? pathname === href : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm transition-colors',
              active
                ? 'bg-accent font-medium text-foreground'
                : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
            )}
          >
            <Icon className={cn('size-4', active && 'text-fusai-accent')} aria-hidden />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

/** Same destinations as a scrollable tab bar for small screens. */
export function AppMobileNav() {
  const navItems: SectionNavItem[] = items.map(({ href, label, exact }) => ({
    href,
    label,
    exact,
  }));
  return <SectionNav label="Painel" items={navItems} />;
}
