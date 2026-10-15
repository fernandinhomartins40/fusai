'use client';

import { Button } from '@fusai/ui/components/button';
import { Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { ApiError, apiFetch } from '@/lib/api';

/** Asks Asaas for the refund; the wallet is debited when the PAYMENT_REFUNDED webhook arrives. */
export function RefundButton({ paymentId }: { paymentId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  return (
    <Button
      variant="ghost"
      size="sm"
      className="text-destructive"
      disabled={pending}
      onClick={async () => {
        if (!confirm('Estornar este Pix? O valor volta ao pagador e os créditos são debitados.'))
          return;
        setPending(true);
        try {
          await apiFetch(`/internal/admin/payments/${paymentId}/refund`, { method: 'POST' });
          toast.success('Estorno solicitado ao Asaas. O débito entra quando ele confirmar.');
          router.refresh();
        } catch (err) {
          toast.error(err instanceof ApiError ? err.message : 'Não foi possível estornar.');
        } finally {
          setPending(false);
        }
      }}
    >
      {pending ? <Loader2 className="animate-spin" /> : null}
      Estornar
    </Button>
  );
}
