'use client';

import { Select } from '@fuseai/ui/components/select';
import { cn } from '@fuseai/ui/lib/utils';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { type ReactNode, useTransition } from 'react';

export type FilterDef = {
  name: string;
  label: string;
  options: { value: string; label: string }[];
  /** Value used when the param is absent. */
  defaultValue?: string;
};

/**
 * One filter row above everything it scopes (dataviz rule). Changing a filter updates the URL;
 * while the server re-renders, the previous content stays visible at reduced opacity.
 */
export function FilterFrame({
  filters,
  children,
  actions,
}: {
  filters: FilterDef[];
  children: ReactNode;
  actions?: ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, start] = useTransition();

  function update(name: string, value: string, defaultValue?: string) {
    const next = new URLSearchParams(params);
    if (!value || value === defaultValue) next.delete(name);
    else next.set(name, value);
    next.delete('cursor');
    start(() => router.push(`${pathname}${next.size ? `?${next}` : ''}`, { scroll: false }));
  }

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-end gap-3">
        {filters.map((f) => (
          <label key={f.name} htmlFor={`filter-${f.name}`} className="grid min-w-36 gap-1 text-sm">
            <span className="text-muted-foreground text-xs">{f.label}</span>
            <Select
              id={`filter-${f.name}`}
              value={params.get(f.name) ?? f.defaultValue ?? ''}
              onChange={(e) => update(f.name, e.target.value, f.defaultValue)}
              disabled={pending}
            >
              {f.options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </label>
        ))}
        {actions ? <div className="ml-auto flex items-end gap-2">{actions}</div> : null}
      </div>
      <div
        aria-busy={pending}
        className={cn('grid gap-6 transition-opacity', pending && 'opacity-50')}
      >
        {children}
      </div>
    </div>
  );
}
