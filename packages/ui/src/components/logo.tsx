import { useId } from 'react';
import { cn } from '../lib/utils';

/** FuseAI mark (decorative): two strokes fusing into one, painted with the brand gradient. */
export function LogoMark({ className }: { className?: string }) {
  const gradientId = useId();
  return (
    <svg viewBox="0 0 32 32" fill="none" className={cn('size-8', className)} aria-hidden="true">
      <defs>
        <linearGradient
          id={gradientId}
          x1="3"
          y1="4"
          x2="29"
          y2="28"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#F59E0B" />
          <stop offset="0.5" stopColor="#EC4899" />
          <stop offset="1" stopColor="#8B5CF6" />
        </linearGradient>
      </defs>
      <g stroke={`url(#${gradientId})`} strokeWidth="3.5" strokeLinecap="round">
        <path d="M4 7c8 0 9 9 16 9" />
        <path d="M4 25c8 0 9-9 16-9" />
        <path d="M20 16h8" />
      </g>
    </svg>
  );
}

type LogoProps = { className?: string; markClassName?: string; showMark?: boolean };

/** Wordmark "fuseai" with "ai" in the brand gradient. */
export function Logo({ className, markClassName, showMark = true }: LogoProps) {
  return (
    <span className={cn('inline-flex items-center gap-2 font-semibold tracking-tight', className)}>
      {showMark ? <LogoMark className={cn('size-7', markClassName)} /> : null}
      <span className="sr-only">FuseAI</span>
      <span aria-hidden="true" className="text-xl leading-none">
        fuse<span className="text-fuse-gradient">ai</span>
      </span>
    </span>
  );
}
