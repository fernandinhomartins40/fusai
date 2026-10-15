/** Credit package a project sells to its end users. */
export type ProjectPackage = {
  id: string;
  name: string;
  priceCents: number;
  creditMicros: string;
  bonusMicros: string;
  highlight: boolean;
  active: boolean;
  sortOrder: number;
};

export type AppUserInfo = {
  id: string;
  externalId: string;
  email: string | null;
  name: string | null;
  balanceMicros: string;
  availableMicros: string;
  createdAt: string;
};

export type AppUserPage = { total: number; appUsers: AppUserInfo[]; nextCursor: string | null };

export type WebhookDelivery = {
  id: string;
  event: string;
  status: 'pending' | 'delivered' | 'failed';
  attempts: number;
  responseStatus: number | null;
  lastError: string | null;
  nextAttemptAt: string | null;
  deliveredAt: string | null;
  createdAt: string;
  payload: unknown;
};

export type WebhookDeliveryPage = {
  webhookUrl: string | null;
  deliveries: WebhookDelivery[];
  nextCursor: string | null;
};

/** Public data of a hosted checkout (`/public/checkout/:id`). */
export type PublicCheckout = {
  checkoutId: string;
  status: 'PENDING' | 'CONFIRMED' | 'RECEIVED' | 'REFUNDED' | 'EXPIRED' | 'CANCELED' | 'FAILED';
  amountCents: number;
  creditMicros: string;
  packageName: string | null;
  merchantName: string;
  copyPaste: string | null;
  qrBase64: string | null;
  expiresAt: string | null;
  paidAt: string | null;
  returnUrl: string | null;
};
