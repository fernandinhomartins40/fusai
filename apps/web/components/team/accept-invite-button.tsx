'use client';

import { Button } from '@fuseai/ui/components/button';
import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import { FormAlert } from '@/components/form-field';
import { setCurrentOrgCookie } from '@/components/org-switcher';
import { ApiError, apiFetch } from '@/lib/api';

export function AcceptInviteButton({ token }: { token: string }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="grid gap-3">
      {error ? <FormAlert>{error}</FormAlert> : null}
      <Button
        variant="brand"
        disabled={pending}
        onClick={async () => {
          setPending(true);
          setError(null);
          try {
            const res = await apiFetch<{ orgId: string }>(
              `/internal/invitations/${encodeURIComponent(token)}/accept`,
              {
                method: 'POST',
              },
            );
            setCurrentOrgCookie(res.orgId);
            window.location.assign('/app');
          } catch (err) {
            setError(err instanceof ApiError ? err.message : 'Não foi possível aceitar o convite.');
            setPending(false);
          }
        }}
      >
        {pending ? <Loader2 className="animate-spin" /> : null}
        Aceitar convite
      </Button>
    </div>
  );
}
