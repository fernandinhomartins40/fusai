'use client';

import { ErrorState } from '@/components/states/error-state';

export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <ErrorState reset={reset} digest={error.digest} homeHref="/" />;
}
