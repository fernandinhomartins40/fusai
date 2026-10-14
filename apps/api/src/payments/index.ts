import type { Env } from '../lib/env';
import { ASAAS_URLS, AsaasProvider } from './asaas';
import type { PaymentProvider } from './types';

export function createPaymentProvider(env: Env): PaymentProvider {
  return new AsaasProvider({
    apiKey: env.ASAAS_API_KEY ?? '',
    baseUrl: (env.ASAAS_API_URL ?? ASAAS_URLS[env.ASAAS_ENV]).replace(/\/+$/, ''),
    webhookToken: env.ASAAS_WEBHOOK_TOKEN,
  });
}

export type { PaymentProvider } from './types';
