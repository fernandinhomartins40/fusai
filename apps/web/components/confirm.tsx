'use client';

import { ConfirmDialog } from '@fusai/ui/components/confirm-dialog';
import { useSyncExternalStore } from 'react';

type Request = {
  title: string;
  description?: string;
  confirmLabel: string;
  destructive: boolean;
  resolve: (ok: boolean) => void;
};

let current: Request | null = null;
const listeners = new Set<() => void>();
const emit = () => {
  for (const l of listeners) l();
};

/**
 * Promise-based replacement for window.confirm(), rendered by <ConfirmHost/>.
 * "Pergunta? Detalhe." becomes the title "Pergunta?" and the description "Detalhe.".
 */
export function confirmAction(
  message: string,
  opts: { confirmLabel?: string; destructive?: boolean } = {},
): Promise<boolean> {
  current?.resolve(false);
  const cut = message.indexOf('?') + 1;
  const title = cut > 0 ? message.slice(0, cut) : message;
  const description = cut > 0 ? message.slice(cut).trim() || undefined : undefined;
  return new Promise((resolve) => {
    current = {
      title,
      description,
      confirmLabel: opts.confirmLabel ?? 'Confirmar',
      destructive: opts.destructive ?? false,
      resolve,
    };
    emit();
  });
}

function settle(ok: boolean) {
  const req = current;
  current = null;
  emit();
  req?.resolve(ok);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Mounted once in the root layout, next to the Toaster. */
export function ConfirmHost() {
  const req = useSyncExternalStore(
    subscribe,
    () => current,
    () => null,
  );
  return (
    <ConfirmDialog
      open={!!req}
      title={req?.title ?? ''}
      description={req?.description}
      confirmLabel={req?.confirmLabel}
      destructive={req?.destructive}
      onConfirm={() => settle(true)}
      onCancel={() => settle(false)}
    />
  );
}
