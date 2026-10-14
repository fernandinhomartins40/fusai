export type LedgerType = 'PURCHASE' | 'USAGE' | 'REFUND' | 'ADJUSTMENT' | 'BONUS' | 'EXPIRATION';

export type LedgerItem = {
  id: string;
  type: LedgerType;
  amountMicros: string;
  balanceAfter: string;
  referenceType: string | null;
  referenceId: string | null;
  description: string | null;
  createdAt: string;
};

export type LedgerPage = { items: LedgerItem[]; nextCursor: string | null };

export type WalletInfo = {
  id: string;
  balanceMicros: string;
  reservedMicros: string;
  availableMicros: string;
};

export const ledgerTypeLabel: Record<LedgerType, string> = {
  PURCHASE: 'Compra de créditos',
  USAGE: 'Consumo',
  REFUND: 'Estorno',
  ADJUSTMENT: 'Ajuste',
  BONUS: 'Bônus',
  EXPIRATION: 'Expiração',
};
