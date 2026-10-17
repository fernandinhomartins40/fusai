import { Button } from '@fusai/ui/components/button';
import Link from 'next/link';

/** Cursor pagination for server-rendered admin lists (keeps the other filters). */
export function Pager({
  path,
  params,
  cursor,
  nextCursor,
}: {
  path: string;
  params: Record<string, string | undefined>;
  cursor?: string;
  nextCursor: string | null | undefined;
}) {
  if (!cursor && !nextCursor) return null;
  const base = Object.fromEntries(
    Object.entries(params).filter((e): e is [string, string] => !!e[1] && e[0] !== 'cursor'),
  );
  const href = (extra: Record<string, string>) => {
    const q = new URLSearchParams({ ...base, ...extra });
    return q.size ? `${path}?${q}` : path;
  };
  return (
    <div className="flex justify-between">
      {cursor ? (
        <Button asChild variant="ghost">
          <Link href={href({})}>Início</Link>
        </Button>
      ) : (
        <span />
      )}
      {nextCursor ? (
        <Button asChild variant="outline">
          <Link href={href({ cursor: nextCursor })}>Próxima página</Link>
        </Button>
      ) : null}
    </div>
  );
}
