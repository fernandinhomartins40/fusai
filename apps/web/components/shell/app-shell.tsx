'use client';

import { cn } from '@fusai/ui/lib/utils';
import { Logo } from '@fusai/ui/logo';
import { Ellipsis, LogOut, Moon, Sun, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useTheme } from 'next-themes';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { authClient } from '@/lib/auth-client';
import {
  isActive,
  NAV,
  type NavItem,
  type ShellVariant,
  SWITCH_TO_ADMIN,
  SWITCH_TO_APP,
} from './nav-config';

type ShellProps = {
  variant: ShellVariant;
  user: { name: string; email: string };
  /** Super admins see a link to the other panel. */
  canSwitch: boolean;
  /** Optional control under the logo (e.g. organization switcher). */
  topSlot?: ReactNode;
  children: ReactNode;
};

/**
 * Dashboard shell (customer and admin):
 * - desktop: fixed sidebar on the left, content on the right;
 * - mobile: native-app style with a bottom bar of 5 slots (featured center item) and "Mais"
 *   opening a bottom sheet with the remaining destinations.
 */
export function AppShell({ variant, user, canSwitch, topSlot, children }: ShellProps) {
  const nav = NAV[variant];
  const switchTo = variant === 'admin' ? SWITCH_TO_APP : SWITCH_TO_ADMIN;
  const extra = canSwitch || variant === 'admin' ? [switchTo] : [];
  const home = nav.left[0].href;

  return (
    <div className="min-h-dvh">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r bg-card/40 md:flex">
        <div className="flex h-16 shrink-0 items-center gap-2 px-5">
          <Link href={home} aria-label="Início do painel" className="rounded-lg">
            <Logo className="h-7" />
          </Link>
          {variant === 'admin' ? (
            <span className="rounded-full border px-2 py-0.5 text-[11px] text-muted-foreground">
              Admin
            </span>
          ) : null}
        </div>
        {topSlot ? <div className="px-4 pb-3">{topSlot}</div> : null}
        <nav
          aria-label="Menu principal"
          className="grid flex-1 content-start gap-0.5 overflow-y-auto px-3"
        >
          {nav.sidebar.map((item) => (
            <SidebarLink key={item.href} item={item} />
          ))}
          {extra.length ? <div className="my-2 border-t" /> : null}
          {extra.map((item) => (
            <SidebarLink key={item.href} item={item} />
          ))}
        </nav>
        <div className="grid gap-1 border-t p-3">
          <div className="grid px-2 pb-1">
            <span className="truncate font-medium text-sm">{user.name}</span>
            <span className="truncate text-muted-foreground text-xs">{user.email}</span>
          </div>
          <ThemeButton className="justify-start" withLabel />
          <SignOut className="justify-start" />
        </div>
      </aside>

      {/* Mobile top bar */}
      <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-background/85 px-4 backdrop-blur md:hidden">
        <Link href={home} aria-label="Início do painel" className="rounded-lg">
          <Logo className="h-6" />
        </Link>
        {variant === 'admin' ? (
          <span className="rounded-full border px-2 py-0.5 text-[11px] text-muted-foreground">
            Admin
          </span>
        ) : null}
        <div className="ml-auto">{topSlot}</div>
      </header>

      <div className="md:pl-64">
        <main
          className="mx-auto max-w-6xl px-4 pt-6 sm:px-6 md:px-8 md:pt-8 md:pb-12"
          style={{ paddingBottom: 'calc(6.5rem + env(safe-area-inset-bottom))' }}
        >
          {children}
        </main>
      </div>

      <BottomBar variant={variant} extra={extra} user={user} />
    </div>
  );
}

function SidebarLink({ item }: { item: NavItem }) {
  const pathname = usePathname();
  const active = isActive(pathname, item);
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition-colors',
        active
          ? 'bg-accent font-medium text-foreground'
          : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
      )}
    >
      <Icon className={cn('size-4', active && 'text-fusai-accent')} aria-hidden />
      {item.label}
    </Link>
  );
}

function BottomBar({
  variant,
  extra,
  user,
}: {
  variant: ShellVariant;
  extra: NavItem[];
  user: ShellProps['user'];
}) {
  const nav = NAV[variant];
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const inBar = [...nav.left, nav.center, nav.right];
  const more = [...nav.sidebar.filter((i) => !inBar.includes(i)), ...extra];
  const moreActive = more.some((i) => isActive(pathname, i));

  // Close the sheet whenever the route changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: run on navigation only
  useEffect(() => setOpen(false), [pathname]);

  return (
    <>
      <nav
        aria-label="Menu principal"
        className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/90 backdrop-blur md:hidden"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <ul className="mx-auto grid h-16 max-w-md grid-cols-5 items-center">
          {nav.left.map((item) => (
            <li key={item.href} className="h-full">
              <TabLink item={item} active={isActive(pathname, item)} />
            </li>
          ))}
          <li className="flex h-full justify-center">
            <CenterLink item={nav.center} active={isActive(pathname, nav.center)} />
          </li>
          <li className="h-full">
            <TabLink item={nav.right} active={isActive(pathname, nav.right)} />
          </li>
          <li className="h-full">
            <button
              type="button"
              onClick={() => setOpen(true)}
              aria-haspopup="dialog"
              aria-expanded={open}
              className={cn(
                'flex h-full w-full flex-col items-center justify-center gap-1 text-[11px] transition-colors',
                moreActive ? 'text-fusai-accent' : 'text-muted-foreground',
              )}
            >
              <Ellipsis className="size-5" aria-hidden />
              Mais
            </button>
          </li>
        </ul>
      </nav>
      <MoreSheet open={open} onClose={() => setOpen(false)} items={more} user={user} />
    </>
  );
}

function TabLink({ item, active }: { item: NavItem; active: boolean }) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex h-full flex-col items-center justify-center gap-1 text-[11px] transition-colors',
        active ? 'font-medium text-fusai-accent' : 'text-muted-foreground',
      )}
    >
      <Icon className="size-5" aria-hidden />
      {item.label}
    </Link>
  );
}

/** Featured center action: raised circle in the brand fill. */
function CenterLink({ item, active }: { item: NavItem; active: boolean }) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      aria-current={active ? 'page' : undefined}
      className="-mt-6 flex flex-col items-center gap-1 text-[11px]"
    >
      <span
        className={cn(
          'flex size-14 items-center justify-center rounded-full bg-fusai-fill text-white shadow-fusai-blue/40 shadow-lg ring-4 ring-background transition-transform active:scale-95',
          active && 'ring-fusai-accent/40',
        )}
      >
        <Icon className="size-6" aria-hidden />
      </span>
      <span className={cn(active ? 'font-medium text-fusai-accent' : 'text-muted-foreground')}>
        {item.label}
      </span>
    </Link>
  );
}

/** Bottom sheet on the native <dialog>: focus trap, Esc and backdrop come from the browser. */
function MoreSheet({
  open,
  onClose,
  items,
  user,
}: {
  open: boolean;
  onClose: () => void;
  items: NavItem[];
  user: ShellProps['user'];
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const pathname = usePathname();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: backdrop click only; Esc closes natively
    <dialog
      ref={ref}
      aria-label="Mais opções"
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      className="m-0 mt-auto w-full max-w-none rounded-t-3xl border-t bg-card p-0 text-card-foreground backdrop:bg-black/60 backdrop:backdrop-blur-sm md:hidden"
      style={{ maxHeight: '85dvh' }}
    >
      {open ? (
        <div
          className="grid gap-4 p-4"
          style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))' }}
        >
          <div className="flex items-center justify-between">
            <span className="mx-auto h-1.5 w-10 rounded-full bg-border" aria-hidden />
          </div>
          <div className="flex items-start justify-between gap-3">
            <div className="grid min-w-0">
              <span className="truncate font-medium">{user.name}</span>
              <span className="truncate text-muted-foreground text-sm">{user.email}</span>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Fechar"
              className="rounded-full p-2 text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <X className="size-5" aria-hidden />
            </button>
          </div>
          <ul className="grid grid-cols-3 gap-2">
            {items.map((item) => {
              const Icon = item.icon;
              const active = isActive(pathname, item);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={onClose}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'flex flex-col items-center gap-2 rounded-2xl border p-3 text-center text-xs transition-colors',
                      active
                        ? 'border-fusai-accent/50 bg-accent text-foreground'
                        : 'hover:bg-accent/60',
                    )}
                  >
                    <Icon
                      className={cn(
                        'size-5',
                        active ? 'text-fusai-accent' : 'text-muted-foreground',
                      )}
                      aria-hidden
                    />
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
          <div className="grid grid-cols-2 gap-2">
            <ThemeButton className="justify-center border" withLabel />
            <SignOut className="justify-center border" />
          </div>
        </div>
      ) : null}
    </dialog>
  );
}

function ThemeButton({ className, withLabel }: { className?: string; withLabel?: boolean }) {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const dark = mounted ? resolvedTheme === 'dark' : true;
  return (
    <button
      type="button"
      onClick={() => setTheme(dark ? 'light' : 'dark')}
      className={cn(
        'flex items-center gap-3 rounded-xl px-3 py-2 text-muted-foreground text-sm transition-colors hover:bg-accent/60 hover:text-foreground',
        className,
      )}
    >
      {dark ? <Sun className="size-4" aria-hidden /> : <Moon className="size-4" aria-hidden />}
      {withLabel ? (
        dark ? (
          'Tema claro'
        ) : (
          'Tema escuro'
        )
      ) : (
        <span className="sr-only">Trocar tema</span>
      )}
    </button>
  );
}

function SignOut({ className }: { className?: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  return (
    <button
      type="button"
      disabled={pending}
      onClick={async () => {
        setPending(true);
        await authClient.signOut();
        router.replace('/entrar');
        router.refresh();
      }}
      className={cn(
        'flex items-center gap-3 rounded-xl px-3 py-2 text-muted-foreground text-sm transition-colors hover:bg-accent/60 hover:text-foreground disabled:opacity-50',
        className,
      )}
    >
      <LogOut className="size-4" aria-hidden />
      Sair
    </button>
  );
}
