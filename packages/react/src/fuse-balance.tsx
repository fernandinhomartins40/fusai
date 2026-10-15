import { type Balance, formatMicros } from '@fuseai/sdk';
import { type CSSProperties, useEffect, useState } from 'react';
import { type FuseClientProps, useFuseClient } from './context';

type Props = FuseClientProps & {
  /** Change it (e.g. after a purchase or a chat) to reload the balance. */
  refreshKey?: unknown;
  /** Also reload every N ms (default: off). */
  refreshIntervalMs?: number;
  className?: string;
  style?: CSSProperties;
  onLoad?: (balance: Balance) => void;
};

/** The end user's available credits, e.g. "R$ 12,34". */
export function FuseBalance({
  refreshKey,
  refreshIntervalMs,
  className,
  style,
  onLoad,
  ...client
}: Props) {
  const fuse = useFuseClient(client);
  const [balance, setBalance] = useState<Balance | null>(null);
  const [failed, setFailed] = useState(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: refreshKey is an explicit trigger
  useEffect(() => {
    if (!fuse) return;
    let alive = true;
    const load = () =>
      fuse
        .balance()
        .then((b) => {
          if (!alive) return;
          setBalance(b);
          setFailed(false);
          onLoad?.(b);
        })
        .catch(() => alive && setFailed(true));
    void load();
    const t = refreshIntervalMs ? setInterval(load, refreshIntervalMs) : undefined;
    return () => {
      alive = false;
      if (t) clearInterval(t);
    };
  }, [fuse, refreshKey, refreshIntervalMs]);

  return (
    <span className={className} style={style} aria-live="polite" data-fuse-balance="">
      {balance ? formatMicros(balance.available_micros) : failed ? '—' : '…'}
    </span>
  );
}
