import type { Metadata } from 'next';
import { PageHeader } from '@/components/admin/page-header';
import { RefundButton } from '@/components/admin/refund-button';
import { PaymentsTable } from '@/components/payments-table';
import type { PaymentInfo } from '@/lib/payment-types';
import { serverApi } from '@/lib/session';

export const metadata: Metadata = { title: 'Pagamentos' };

type Row = PaymentInfo & { org: { id: string; name: string }; providerPaymentId: string | null };

export default async function AdminPaymentsPage() {
  const { data } = await serverApi<{ items: Row[] }>('/internal/admin/payments');
  const items = data?.items ?? [];
  return (
    <div className="grid gap-6">
      <PageHeader title="Pagamentos" description="Recargas via Pix de todas as organizações." />
      <PaymentsTable
        items={items}
        extraColumn={{
          header: 'Ações',
          cell: (p) =>
            p.status === 'RECEIVED' && p.creditedAt ? <RefundButton paymentId={p.id} /> : null,
        }}
      />
    </div>
  );
}
