'use client';

import { passwordStrength } from '@fusai/shared';
import { cn } from '@fusai/ui/lib/utils';
import { Check, X } from 'lucide-react';

const LEVEL_STYLE = {
  vazia: { bar: 'bg-border', text: 'text-muted-foreground' },
  fraca: { bar: 'bg-destructive', text: 'text-destructive' },
  media: { bar: 'bg-warning', text: 'text-warning-foreground' },
  forte: { bar: 'bg-success', text: 'text-success-foreground' },
} as const;

/** Live strength meter (4 segments) + requirement checklist, same rules the API enforces. */
export function PasswordStrengthMeter({ password, id }: { password: string; id: string }) {
  const s = passwordStrength(password);
  const style = LEVEL_STYLE[s.level];
  return (
    <div id={id} className="grid gap-2">
      <div className="flex items-center gap-3">
        <div className="grid flex-1 grid-cols-4 gap-1" aria-hidden>
          {[1, 2, 3, 4].map((i) => (
            <span
              key={i}
              className={cn(
                'h-1.5 rounded-full transition-colors',
                i <= s.score ? style.bar : 'bg-border',
              )}
            />
          ))}
        </div>
        <span
          className={cn('min-w-12 text-right font-medium text-xs', style.text)}
          aria-live="polite"
        >
          {s.label ? `Senha ${s.label.toLowerCase()}` : ''}
        </span>
      </div>
      <ul className="grid gap-1 text-xs" aria-label="Requisitos da senha">
        {s.requirements.map((r) => (
          <li
            key={r.id}
            className={cn(
              'flex items-center gap-1.5',
              r.met ? 'text-success-foreground' : 'text-muted-foreground',
            )}
          >
            {r.met ? (
              <Check className="size-3.5 shrink-0" aria-hidden />
            ) : (
              <X className="size-3.5 shrink-0" aria-hidden />
            )}
            <span>
              {r.label}
              <span className="sr-only">{r.met ? ' (atendido)' : ' (pendente)'}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** "As senhas conferem" / "não conferem", only once the confirmation has been typed. */
export function PasswordMatch({ password, confirm }: { password: string; confirm: string }) {
  if (!confirm) return null;
  const ok = password === confirm;
  return (
    <p
      className={cn(
        'flex items-center gap-1.5 text-xs',
        ok ? 'text-success-foreground' : 'text-destructive',
      )}
      aria-live="polite"
    >
      {ok ? <Check className="size-3.5" aria-hidden /> : <X className="size-3.5" aria-hidden />}
      {ok ? 'As senhas conferem' : 'As senhas não conferem'}
    </p>
  );
}
