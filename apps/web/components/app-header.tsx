import { Badge } from '@fuseai/ui/components/badge';
import { Logo } from '@fuseai/ui/logo';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { SignOutButton } from './sign-out-button';
import { ThemeToggle } from './theme-toggle';

type AppHeaderProps = {
  home: string;
  userName: string;
  badge?: string;
  children?: ReactNode;
  /** Extra controls on the right, visible on every screen size (e.g. org switcher). */
  actions?: ReactNode;
};

/** Top bar shared by the customer dashboard and the admin panel. */
export function AppHeader({ home, userName, badge, children, actions }: AppHeaderProps) {
  return (
    <header className="sticky top-0 z-30 border-b bg-background/80 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4 sm:px-6">
        <Link href={home} aria-label="Início do painel" className="rounded-lg">
          <Logo markClassName="size-6" className="[&>span:last-child]:text-lg" />
        </Link>
        {badge ? <Badge variant="outline">{badge}</Badge> : null}
        <nav className="ml-2 hidden items-center gap-1 text-sm sm:flex">{children}</nav>
        <div className="ml-auto flex items-center gap-1">
          {actions}
          <span className="hidden max-w-40 truncate text-muted-foreground text-sm md:inline">
            {userName}
          </span>
          <ThemeToggle />
          <SignOutButton />
        </div>
      </div>
    </header>
  );
}

export function NavLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="rounded-lg px-3 py-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
    >
      {children}
    </Link>
  );
}
