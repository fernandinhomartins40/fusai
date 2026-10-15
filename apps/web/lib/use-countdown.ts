'use client';

import { useEffect, useState } from 'react';

/** Ticks every second; returns the time left until `until` as "m:ss" (null without a deadline). */
export function useCountdown(until: string | null) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  if (!until) return null;
  const left = Math.max(0, new Date(until).getTime() - now);
  const m = Math.floor(left / 60_000);
  const s = Math.floor((left % 60_000) / 1000);
  return { left, text: `${m}:${String(s).padStart(2, '0')}` };
}
