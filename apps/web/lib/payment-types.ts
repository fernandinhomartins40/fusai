export type PaymentStatus =
  | 'PENDING'
  | 'CONFIRMED'
  | 'RECEIVED'
  | 'EXPIRED'
  | 'REFUNDED'
  | 'FAILED'
  | 'CANCELED';

export type PaymentInfo = {
  id: string;
  status: PaymentStatus;
  amountCents: number;
  creditMicros: string;
  bonusMicros: string;
  feeCents: number;
  packageName: string | null;
  pixCopyPaste: string | null;
  pixQrBase64: string | null;
  expiresAt: string | null;
  paidAt: string | null;
  creditedAt: string | null;
  createdAt: string;
};

export type TopupOptions = {
  canTopup: boolean;
  hasDocument: boolean;
  minTopupCents: number;
  maxTopupCents: number;
  feePct: string;
  suggestedTopupCents: number | null;
  packages: {
    id: string;
    name: string;
    priceCents: number;
    creditMicros: string;
    bonusMicros: string;
    highlight: boolean;
  }[];
};

export const paymentStatusLabel: Record<
  PaymentStatus,
  { label: string; variant: 'success' | 'warning' | 'secondary' | 'destructive' }
> = {
  PENDING: { label: 'Aguardando', variant: 'warning' },
  CONFIRMED: { label: 'Confirmado', variant: 'success' },
  RECEIVED: { label: 'Pago', variant: 'success' },
  EXPIRED: { label: 'Expirado', variant: 'secondary' },
  REFUNDED: { label: 'Estornado', variant: 'destructive' },
  FAILED: { label: 'Falhou', variant: 'destructive' },
  CANCELED: { label: 'Cancelado', variant: 'secondary' },
};
