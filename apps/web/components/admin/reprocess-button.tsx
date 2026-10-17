'use client';

import { Button } from '@fusai/ui/components/button';
import { Loader2, RotateCcw } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { ApiError, apiFetch } from '@/lib/api';

/** Queues a payment webhook again (crediting is idempotent: never credits twice). */
export function ReprocessButton({ eventId }: { eventId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function run() {
    setPending(true);
    try {
      await apiFetch(`/internal/admin/webhook-events/${eventId}/reprocess`, { method: 'POST' });
      toast.success('Evento na fila para reprocessar');
      // The worker usually finishes within a second or two.
      setTimeout(() => router.refresh(), 2000);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Não foi possível reprocessar.');
    } finally {
      setPending(false);
    }
  }

  return (
    <Button size="sm" variant="outline" onClick={run} disabled={pending}>
      {pending ? <Loader2 className="animate-spin" /> : <RotateCcw />}
      Reprocessar
    </Button>
  );
}
