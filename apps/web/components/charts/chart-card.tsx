'use client';

import { Button } from '@fuseai/ui/components/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@fuseai/ui/components/card';
import { BarChart3, Table2 } from 'lucide-react';
import { type ReactNode, useState } from 'react';

type ChartCardProps = {
  title: string;
  description?: string;
  chart: ReactNode;
  /** Table twin of the chart: every value stays reachable without hovering (WCAG). */
  table: ReactNode;
  empty?: boolean;
  emptyText?: string;
};

export function ChartCard({ title, description, chart, table, empty, emptyText }: ChartCardProps) {
  const [showTable, setShowTable] = useState(false);
  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div className="grid gap-1">
          <CardTitle className="text-base">{title}</CardTitle>
          {description ? <CardDescription>{description}</CardDescription> : null}
        </div>
        {empty ? null : (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowTable((v) => !v)}
            aria-pressed={showTable}
          >
            {showTable ? <BarChart3 /> : <Table2 />}
            {showTable ? 'Ver gráfico' : 'Ver tabela'}
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {empty ? (
          <p className="py-10 text-center text-muted-foreground text-sm">
            {emptyText ?? 'Sem dados no período.'}
          </p>
        ) : showTable ? (
          <div className="max-h-80 overflow-auto">{table}</div>
        ) : (
          chart
        )}
      </CardContent>
    </Card>
  );
}
