import type { ReactNode } from 'react';

/** Landing section with an anchored h2 (#como-funciona, #faq…). */
export function Section({
  id,
  title,
  subtitle,
  children,
}: {
  id: string;
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-titulo`}
      className="mx-auto max-w-6xl scroll-mt-24 px-4 py-16 sm:px-6"
    >
      <div className="mb-8 max-w-2xl">
        <h2 id={`${id}-titulo`} className="text-balance font-semibold text-3xl tracking-tight">
          {title}
        </h2>
        {subtitle ? <p className="mt-3 text-muted-foreground">{subtitle}</p> : null}
      </div>
      {children}
    </section>
  );
}
