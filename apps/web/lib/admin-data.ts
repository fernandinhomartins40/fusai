import 'server-only';
import type { AdminModel, AdminProvider, AdminSettings } from './admin-types';
import { serverApi } from './session';

/** Everything the model form needs (providers, models for fallbacks, global settings). */
export async function loadModelFormData() {
  const [providers, models, settings] = await Promise.all([
    serverApi<{ providers: AdminProvider[] }>('/internal/admin/providers'),
    serverApi<{ models: AdminModel[] }>('/internal/admin/models'),
    serverApi<AdminSettings>('/internal/admin/settings'),
  ]);
  if (!providers.data || !models.data || !settings.data) {
    throw new Error('Não foi possível carregar os dados do admin');
  }
  return {
    providers: providers.data.providers,
    models: models.data.models,
    settings: settings.data,
  };
}
