import {
  Activity,
  BarChart3,
  BookOpen,
  Boxes,
  CreditCard,
  FolderKanban,
  LayoutDashboard,
  type LucideIcon,
  Plug,
  Receipt,
  Settings,
  Shield,
  Tags,
  Users,
  Wallet,
  Webhook,
} from 'lucide-react';

export type NavItem = { href: string; label: string; icon: LucideIcon; exact?: boolean };

export type NavConfig = {
  /** Full list, in sidebar order (desktop). */
  sidebar: NavItem[];
  /**
   * Mobile bottom bar: 2 items, the featured center item, 2 items. The last slot is "Mais",
   * so the bar shows `left` (2) + `center` + `right` (1) + Mais; the rest goes to the sheet.
   */
  left: [NavItem, NavItem];
  center: NavItem;
  right: NavItem;
};

const customerItems = {
  home: { href: '/app', label: 'Início', icon: LayoutDashboard, exact: true },
  projects: { href: '/app/projetos', label: 'Projetos', icon: FolderKanban },
  wallet: { href: '/app/carteira', label: 'Carteira', icon: Wallet },
  usage: { href: '/app/consumo', label: 'Consumo', icon: BarChart3 },
  logs: { href: '/app/logs', label: 'Logs', icon: Activity },
  webhooks: { href: '/app/webhooks', label: 'Webhooks', icon: Webhook },
  team: { href: '/app/equipe', label: 'Equipe', icon: Users },
  settings: { href: '/app/configuracoes', label: 'Configurações', icon: Settings },
  docs: { href: '/docs', label: 'Docs', icon: BookOpen },
} satisfies Record<string, NavItem>;

const c = customerItems;
export const CUSTOMER_NAV: NavConfig = {
  sidebar: [c.home, c.projects, c.wallet, c.usage, c.logs, c.webhooks, c.team, c.settings, c.docs],
  left: [c.home, c.projects],
  center: c.wallet,
  right: c.usage,
};

const adminItems = {
  home: { href: '/admin', label: 'Início', icon: Shield, exact: true },
  customers: { href: '/admin/clientes', label: 'Clientes', icon: Users },
  payments: { href: '/admin/pagamentos', label: 'Pagamentos', icon: Receipt },
  providers: { href: '/admin/provedores', label: 'Provedores', icon: Plug },
  models: { href: '/admin/modelos', label: 'Modelos', icon: Boxes },
  prices: { href: '/admin/precos', label: 'Preços', icon: Tags },
} satisfies Record<string, NavItem>;

const a = adminItems;
export const ADMIN_NAV: NavConfig = {
  sidebar: [a.home, a.customers, a.payments, a.providers, a.models, a.prices],
  left: [a.home, a.customers],
  center: a.payments,
  right: a.models,
};

/** Cross-link between the two panels (sidebar footer and "Mais" sheet). */
export const SWITCH_TO_ADMIN: NavItem = { href: '/admin', label: 'Admin', icon: Shield };
export const SWITCH_TO_APP: NavItem = {
  href: '/app',
  label: 'Painel do cliente',
  icon: CreditCard,
};

export const NAV = { customer: CUSTOMER_NAV, admin: ADMIN_NAV } as const;
export type ShellVariant = keyof typeof NAV;

export function isActive(pathname: string, item: Pick<NavItem, 'href' | 'exact'>) {
  return item.exact
    ? pathname === item.href
    : pathname === item.href || pathname.startsWith(`${item.href}/`);
}
