import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@fuseai/ui/components/card';
import type { ReactNode } from 'react';

type AuthShellProps = {
  title: string;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
};

export function AuthShell({ title, description, children, footer }: AuthShellProps) {
  return (
    <div className="w-full max-w-md">
      <Card>
        <CardHeader className="gap-2">
          <CardTitle className="text-2xl">{title}</CardTitle>
          {description ? <CardDescription>{description}</CardDescription> : null}
        </CardHeader>
        <CardContent>{children}</CardContent>
      </Card>
      {footer ? (
        <div className="mt-6 text-center text-muted-foreground text-sm">{footer}</div>
      ) : null}
    </div>
  );
}
