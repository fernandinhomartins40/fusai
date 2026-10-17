import {
  Activity,
  BarChart3,
  BookOpen,
  Bot,
  Boxes,
  Building2,
  CreditCard,
  FolderKanban,
  Gift,
  Inbox,
  LayoutDashboard,
  type LucideIcon,
  Plug,
  Receipt,
  ScrollText,
  Server,
  Settings,
  Shield,
  Tags,
  UserRound,
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
  agent: { href: '/app/agente', label: 'Agente de IA', icon: Bot },
  docs: { href: '/docs', label: 'Docs', icon: BookOpen },
} satisfies Record<string, NavItem>;

const c = customerItems;
export const CUSTOMER_NAV: NavConfig = {
  sidebar: [
    c.home,
    c.projects,
    c.wallet,
    c.usage,
    c.logs,
    c.webhooks,
    c.team,
    c.agent,
    c.settings,
    c.docs,
  ],
  left: [c.home, c.projects],
  center: c.wallet,
  right: c.usage,
};

const adminItems = {
  home: { href: '/admin', label: 'Início', icon: Shield, exact: true },
  customers: { href: '/admin/clientes', label: 'Clientes', icon: Building2 },
  users: { href: '/admin/usuarios', label: 'Usuários', icon: UserRound },
  payments: { href: '/admin/pagamentos', label: 'Pagamentos', icon: Receipt },
  packages: { href: '/admin/pacotes', label: 'Pacotes', icon: Gift },
  providers: { href: '/admin/provedores', label: 'Provedores', icon: Plug },
  models: { href: '/admin/modelos', label: 'Modelos', icon: Boxes },
  prices: { href: '/admin/precos', label: 'Preços', icon: Tags },
  usage: { href: '/admin/uso', label: 'Uso', icon: Activity },
  webhooks: { href: '/admin/webhooks', label: 'Webhooks', icon: Inbox },
  audit: { href: '/admin/auditoria', label: 'Auditoria', icon: ScrollText },
  system: { href: '/admin/sistema', label: 'Sistema', icon: Server },
} satisfies Record<string, NavItem>;

const a = adminItems;
export const ADMIN_NAV: NavConfig = {
  sidebar: [
    a.home,
    a.customers,
    a.users,
    a.payments,
    a.packages,
    a.providers,
    a.models,
    a.prices,
    a.usage,
    a.webhooks,
    a.audit,
    a.system,
  ],
  left: [a.home, a.payments],
  // Customers is the daily task (balance, release credits, suspend): featured in the center.
  center: a.customers,
  right: a.usage,
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
