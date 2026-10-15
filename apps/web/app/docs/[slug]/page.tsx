import { DOC_PAGES, getDoc } from '@fusai/docs';
import { ArrowLeft, ArrowRight, FileText } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { docHtml, docNeighbors } from '@/lib/docs';

type Props = { params: Promise<{ slug: string }> };

export const dynamicParams = false;
export const generateStaticParams = () => DOC_PAGES.map((p) => ({ slug: p.slug }));

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const page = getDoc((await params).slug);
  if (!page) return {};
  return {
    title: page.title,
    description: page.description,
    alternates: { canonical: `/docs/${page.slug}` },
  };
}

export default async function DocPage({ params }: Props) {
  const { slug } = await params;
  const page = getDoc(slug);
  if (!page) notFound();
  const { prev, next } = docNeighbors(slug);

  return (
    <article className="grid gap-8">
      <header className="grid gap-2">
        <h1 className="font-semibold text-3xl tracking-tight">{page.title}</h1>
        <p className="text-lg text-muted-foreground">{page.description}</p>
        <a
          href={`/docs/${slug}.md`}
          className="flex w-fit items-center gap-1.5 text-muted-foreground text-xs hover:text-foreground"
        >
          <FileText className="size-3.5" aria-hidden /> Ver em Markdown (para IAs)
        </a>
      </header>
      {/* biome-ignore lint/security/noDangerouslySetInnerHtml: our own Markdown, rendered on the server */}
      <div className="docs-prose" dangerouslySetInnerHTML={{ __html: docHtml(page) }} />
      <nav
        aria-label="Página anterior e próxima"
        className="grid gap-3 border-t pt-6 sm:grid-cols-2"
      >
        {prev ? (
          <Link
            href={`/docs/${prev.slug}`}
            className="grid gap-0.5 rounded-xl border p-4 hover:bg-accent/50"
          >
            <span className="flex items-center gap-1 text-muted-foreground text-xs">
              <ArrowLeft className="size-3.5" aria-hidden /> Anterior
            </span>
            <span className="font-medium">{prev.title}</span>
          </Link>
        ) : (
          <span />
        )}
        {next ? (
          <Link
            href={`/docs/${next.slug}`}
            className="grid gap-0.5 rounded-xl border p-4 text-right hover:bg-accent/50"
          >
            <span className="flex items-center justify-end gap-1 text-muted-foreground text-xs">
              Próxima <ArrowRight className="size-3.5" aria-hidden />
            </span>
            <span className="font-medium">{next.title}</span>
          </Link>
        ) : null}
      </nav>
    </article>
  );
}
