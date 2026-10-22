import Link from 'next/link';
import { isFilled, legal } from '@/lib/legal';

/** Public footer: legal links and company identification (shown once the owner fills it in). */
export function SiteFooter() {
  const company = [
    isFilled(legal.companyName) ? legal.companyName : null,
    isFilled(legal.cnpj) ? `CNPJ ${legal.cnpj}` : null,
  ].filter(Boolean);
  return (
    <footer className="border-t">
      <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-8 text-muted-foreground text-sm sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <p>
          © {new Date().getFullYear()} {[legal.brand, ...company].join(' · ')}
        </p>
        <nav aria-label="Links institucionais" className="flex flex-wrap gap-x-5 gap-y-2">
          <Link href="/modelos" className="hover:text-foreground">
            Modelos
          </Link>
          <Link href="/precos" className="hover:text-foreground">
            Preços
          </Link>
          <Link href="/docs" className="hover:text-foreground">
            Docs
          </Link>
          <Link href="/termos" className="hover:text-foreground">
            Termos de uso
          </Link>
          <Link href="/privacidade" className="hover:text-foreground">
            Privacidade
          </Link>
          {isFilled(legal.supportEmail) ? (
            <a href={`mailto:${legal.supportEmail}`} className="hover:text-foreground">
              Contato
            </a>
          ) : null}
        </nav>
      </div>
    </footer>
  );
}
