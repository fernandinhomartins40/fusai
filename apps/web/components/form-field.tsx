import { Label } from '@fusai/ui/components/label';
import { cloneElement, isValidElement, type ReactElement, type ReactNode } from 'react';

type FieldProps = {
  id: string;
  label: string;
  error?: string;
  hint?: string;
  children: ReactNode;
};

type Describable = ReactElement<{ id?: string; 'aria-describedby'?: string }>;

/** Adds the visible hint/error ids to the control's aria-describedby (keeps ids it already has). */
function describe(children: ReactNode, id: string, extra: string | null): ReactNode {
  if (!extra || !isValidElement(children)) return children;
  const child = children as Describable;
  if (child.props.id !== id) return children;
  const ids = new Set((child.props['aria-describedby'] ?? '').split(' ').filter(Boolean));
  ids.add(extra);
  return cloneElement(child, { 'aria-describedby': [...ids].join(' ') });
}

/** Label + control + hint/error, wired for screen readers via `${id}-error` / `${id}-hint`. */
export function Field({ id, label, error, hint, children }: FieldProps) {
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : null;
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      {describe(children, id, describedBy)}
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-destructive text-sm">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-muted-foreground text-xs">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function FormAlert({
  children,
  tone = 'error',
}: {
  children: ReactNode;
  tone?: 'error' | 'success' | 'info';
}) {
  const styles =
    tone === 'error'
      ? 'border-destructive/30 bg-destructive/10 text-destructive'
      : tone === 'success'
        ? 'border-success/30 bg-success/10 text-success-foreground'
        : 'border-border bg-muted/40 text-muted-foreground';
  return (
    <div
      role={tone === 'error' ? 'alert' : tone === 'success' ? 'status' : undefined}
      className={`rounded-xl border px-3 py-2 text-sm ${styles}`}
    >
      {children}
    </div>
  );
}
