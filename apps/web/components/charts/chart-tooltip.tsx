import type { ReactNode } from 'react';

/** Tooltip body: value first (strong), label second; a short stroke keys the series. */
export function ChartTooltipBox({
  label,
  value,
  sub,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
}) {
  return (
    <div className="grid min-w-36 gap-1 rounded-xl border bg-popover px-3 py-2 text-popover-foreground text-xs shadow-lg">
      <span className="text-muted-foreground">{label}</span>
      <span className="flex items-center gap-2">
        <span aria-hidden className="h-0.5 w-3 rounded-full bg-chart-series" />
        <span className="font-semibold text-sm">{value}</span>
      </span>
      {sub ? <span className="text-muted-foreground">{sub}</span> : null}
    </div>
  );
}
