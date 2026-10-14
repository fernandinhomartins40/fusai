import type { LogItem } from './dashboard-types';

/** Usage status labels (plain module: usable from server and client components). */
export const statusLabel: Record<
  LogItem['status'],
  { label: string; variant: 'success' | 'warning' | 'destructive' | 'secondary' }
> = {
  SUCCESS: { label: 'Sucesso', variant: 'success' },
  UPSTREAM_ERROR: { label: 'Erro do provedor', variant: 'destructive' },
  CLIENT_ERROR: { label: 'Erro da requisição', variant: 'warning' },
  INSUFFICIENT_FUNDS: { label: 'Sem saldo', variant: 'warning' },
  RATE_LIMITED: { label: 'Limite de taxa', variant: 'secondary' },
};
