import { Card, CardContent } from '@fuseai/ui/components/card';
import { cn } from '@fuseai/ui/lib/utils';
import type { ReactNode } from 'react';

type StatTileProps = {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  hero?: boolean;
  className?: string;
};

/**
 * KPI tile (dataviz: a single value is a number, not a chart).
 * Large values keep proportional figures; `tabular-nums` is only for aligned columns.
 */
export function StatTile({ label, value, hint, hero, className }: StatTileProps) {
  return (
    <Card className={className}>
      <CardContent className="grid gap-1 p-5">
        <span className="text-muted-foreground text-sm">{label}</span>
        <span className={cn('font-semibold tracking-tight', hero ? 'text-4xl' : 'text-2xl')}>
          {value}
        </span>
        {hint ? <span className="text-muted-foreground text-xs">{hint}</span> : null}
      </CardContent>
    </Card>
  );
}
