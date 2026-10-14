import { Logo } from '@fuseai/ui/logo';
import Link from 'next/link';
import type { ReactNode } from 'react';

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="relative isolate flex min-h-dvh flex-col">
      <div
        aria-hidden
        className="bg-fuse-gradient absolute top-[-14rem] left-1/2 -z-10 h-[22rem] w-[40rem] -translate-x-1/2 rounded-full opacity-15 blur-3xl"
      />
      <header className="mx-auto flex w-full max-w-6xl px-4 py-5 sm:px-6">
        <Link href="/" aria-label="FuseAI — página inicial" className="rounded-lg">
          <Logo />
        </Link>
      </header>
      <main className="flex flex-1 items-start justify-center px-4 pt-8 pb-16 sm:items-center sm:pt-0">
        {children}
      </main>
    </div>
  );
}
