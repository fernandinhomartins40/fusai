// Garante o webhook de cobranças da fusai no Asaas (idempotente). Roda no fim do deploy.sh,
// dentro da imagem da API (Node 22, fetch nativo), com as variáveis do .env da VPS:
//   ASAAS_API_KEY, ASAAS_ENV, ASAAS_WEBHOOK_TOKEN, API_URL e ASAAS_WEBHOOK_EMAIL (opcional).
// Nunca imprime a chave nem o token. Sai com 0 mesmo em erro: o deploy não volta por causa disso.

const BASE = {
  sandbox: 'https://api-sandbox.asaas.com/v3',
  production: 'https://api.asaas.com/v3',
};
// Os mesmos eventos que apps/api/src/payments/asaas.ts trata.
const EVENTS = [
  'PAYMENT_RECEIVED',
  'PAYMENT_CONFIRMED',
  'PAYMENT_REFUNDED',
  'PAYMENT_OVERDUE',
  'PAYMENT_DELETED',
];
const NAME = 'fusai - cobrancas Pix';

const key = process.env.ASAAS_API_KEY ?? '';
const env = process.env.ASAAS_ENV === 'production' ? 'production' : 'sandbox';
const token = process.env.ASAAS_WEBHOOK_TOKEN ?? '';
const url = `${(process.env.API_URL ?? 'https://api.fusai.com.br').replace(/\/+$/, '')}/webhooks/asaas`;
const email = process.env.ASAAS_WEBHOOK_EMAIL || process.env.SEED_ADMIN_EMAIL || '';

async function asaas(method, path, body) {
  const res = await fetch(`${BASE[env]}${path}`, {
    method,
    headers: {
      access_token: key,
      'content-type': 'application/json',
      'user-agent': 'fusai-deploy',
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20_000),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const detail = data?.errors?.map((e) => e.description).join('; ') || `HTTP ${res.status}`;
    throw new Error(`${method} ${path}: ${detail}`);
  }
  return data;
}

async function main() {
  if (!key) {
    console.log('Asaas: ASAAS_API_KEY ausente; Pix desligado (configure o secret no GitHub).');
    return;
  }
  const account = await asaas('GET', '/myAccount');
  console.log(`Asaas (${env}): conta conectada${account?.name ? ` (${account.name})` : ''}.`);

  const config = {
    name: NAME,
    url,
    email,
    enabled: true,
    interrupted: false,
    apiVersion: 3,
    authToken: token,
    sendType: 'SEQUENTIALLY',
    events: EVENTS,
  };
  const list = await asaas('GET', '/webhooks?limit=100');
  const existing = (list?.data ?? []).find((w) => w.url === url || w.name === NAME);
  if (existing) {
    await asaas('PUT', `/webhooks/${existing.id}`, config);
    console.log(
      `Asaas: webhook atualizado -> ${url}${existing.interrupted ? ' (fila estava pausada; reativada)' : ''}.`,
    );
  } else {
    await asaas('POST', '/webhooks', config);
    console.log(`Asaas: webhook criado -> ${url}.`);
  }

  // Pix exige ao menos uma chave Pix ativa na conta.
  const pix = await asaas('GET', '/pix/addressKeys?status=ACTIVE').catch(() => null);
  if (pix && (pix.totalCount ?? pix.data?.length ?? 0) === 0) {
    console.log('AVISO Asaas: nenhuma chave Pix ativa na conta. Cadastre uma no painel do Asaas.');
  }
}

main().catch((err) => {
  console.error(`AVISO Asaas: ${err instanceof Error ? err.message : 'erro'}`);
});
