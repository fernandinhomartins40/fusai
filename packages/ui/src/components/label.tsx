import type * as React from 'react';
import { cn } from '../lib/utils';

export function Label({ className, ...props }: React.ComponentProps<'label'>) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: consumers pass htmlFor or nest the control
    <label
      className={cn('font-medium text-sm leading-none peer-disabled:opacity-70', className)}
      {...props}
    />
  );
}
