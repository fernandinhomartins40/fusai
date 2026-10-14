'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';

const ORG_COOKIE = 'fuse_org';

export function setCurrentOrgCookie(orgId: string) {
  // biome-ignore lint/suspicious/noDocumentCookie: a plain preference cookie (not auth), read by the server
  document.cookie = `${ORG_COOKIE}=${encodeURIComponent(orgId)}; path=/; max-age=31536000; samesite=lax`;
}

/** Shown only when the user belongs to more than one organization. */
export function OrgSwitcher({
  orgs,
  currentId,
}: {
  orgs: { id: string; name: string }[];
  currentId: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  if (orgs.length < 2) return null;
  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="sr-only">Organização</span>
      <select
        value={currentId}
        disabled={pending}
        onChange={(e) => {
          setCurrentOrgCookie(e.target.value);
          start(() => {
            router.push('/app');
            router.refresh();
          });
        }}
        className="max-w-44 truncate rounded-lg border border-input bg-transparent px-2 py-1 text-sm"
      >
        {orgs.map((o) => (
          <option key={o.id} value={o.id} className="bg-popover text-popover-foreground">
            {o.name}
          </option>
        ))}
      </select>
    </label>
  );
}
