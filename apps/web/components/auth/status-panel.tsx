import { cn } from '@fusai/ui/lib/utils';
import { CheckCircle2, Clock, MailCheck, XCircle } from 'lucide-react';
import type { ReactNode } from 'react';

type Tone = 'success' | 'error' | 'expired' | 'info';

const ICONS = {
  success: { Icon: CheckCircle2, className: 'bg-success/10 text-success-foreground' },
  error: { Icon: XCircle, className: 'bg-destructive/10 text-destructive' },
  expired: { Icon: Clock, className: 'bg-warning/10 text-warning-foreground' },
  info: { Icon: MailCheck, className: 'bg-fusai-accent/10 text-fusai-accent' },
} as const;

/** Big status icon + message + actions: visual feedback for each auth step. */
export function StatusPanel({
  tone,
  children,
  actions,
}: {
  tone: Tone;
  children: ReactNode;
  actions?: ReactNode;
}) {
  const { Icon, className } = ICONS[tone];
  return (
    <div
      className="grid justify-items-center gap-4 text-center"
      role={tone === 'error' || tone === 'expired' ? 'alert' : 'status'}
    >
      <span className={cn('flex size-16 items-center justify-center rounded-full', className)}>
        <Icon className="size-8" aria-hidden />
      </span>
      <div className="grid gap-1 text-muted-foreground text-sm">{children}</div>
      {actions ? <div className="grid w-full gap-2">{actions}</div> : null}
    </div>
  );
}
