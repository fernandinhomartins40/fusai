'use client';

import { Switch } from '@fuseai/ui/components/switch';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { ApiError, apiFetch } from '@/lib/api';

export function ModelActiveToggle({
  id,
  active,
  label,
}: {
  id: string;
  active: boolean;
  label: string;
}) {
  const router = useRouter();
  const [checked, setChecked] = useState(active);
  const [pending, setPending] = useState(false);

  async function toggle(next: boolean) {
    setPending(true);
    setChecked(next);
    try {
      await apiFetch(`/internal/admin/models/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ active: next }),
      });
      toast.success(next ? `${label} ativado` : `${label} desativado`);
      router.refresh();
    } catch (err) {
      setChecked(!next);
      toast.error(err instanceof ApiError ? err.message : 'Não foi possível alterar.');
    } finally {
      setPending(false);
    }
  }

  return (
    <Switch
      checked={checked}
      onCheckedChange={toggle}
      disabled={pending}
      aria-label={`Ativar ${label}`}
    />
  );
}
