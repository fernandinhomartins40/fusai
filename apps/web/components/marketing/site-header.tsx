import { Button } from '@fusai/ui/components/button';
import { Logo } from '@fusai/ui/logo';
import Link from 'next/link';
import { ThemeToggle } from '@/components/theme-toggle';

const NAV = [
  { href: '/modelos', label: 'Modelos' },
  { href: '/precos', label: 'Preços' },
  { href: '/docs', label: 'Docs' },
];

/** Sticky blurred header of the public pages (PRD §11.2). */
export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-transparent bg-background/70 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <Link href="/" aria-label="fusai — página inicial" className="shrink-0 rounded-lg">
          <Logo />
        </Link>
        <nav aria-label="Principal" className="hidden items-center gap-1 md:flex">
          {NAV.map((item) => (
            <Button key={item.href} asChild variant="ghost" size="sm">
              <Link href={item.href}>{item.label}</Link>
            </Button>
          ))}
        </nav>
        <div className="flex items-center gap-1">
          <ThemeToggle />
          <Button asChild variant="ghost" size="sm" className="hidden sm:inline-flex">
            <Link href="/entrar">Entrar</Link>
          </Button>
          <Button asChild variant="brand" size="sm">
            <Link href="/cadastro">Começar grátis</Link>
          </Button>
        </div>
      </div>
      <nav
        aria-label="Principal (celular)"
        className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-3 pb-2 md:hidden"
      >
        {NAV.map((item) => (
          <Button key={item.href} asChild variant="ghost" size="sm">
            <Link href={item.href}>{item.label}</Link>
          </Button>
        ))}
        <Button asChild variant="ghost" size="sm" className="sm:hidden">
          <Link href="/entrar">Entrar</Link>
        </Button>
      </nav>
    </header>
  );
}
