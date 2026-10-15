import type { DocUrls } from './types';

/** What the guide needs to know about a project (never secrets). */
export type ProjectSnapshot = {
  name: string;
  billingMode: 'ORG_WALLET' | 'END_USER_WALLET' | 'HYBRID';
  allowedOrigins: string[];
  webhookUrl: string | null;
  freeCreditMicros: string;
  defaultModel: string | null;
  /** Prices in BRL per 1M tokens, as decimal strings. */
  models: { id: string; name: string; input: string; output: string }[];
  packages: {
    id: string;
    name: string;
    priceCents: number;
    creditMicros: string;
    bonusMicros: string;
  }[];
};

export const GUIDE_STACKS = [
  'nextjs',
  'react-native',
  'flutter',
  'node',
  'python',
  'laravel',
] as const;
export type GuideStack = (typeof GUIDE_STACKS)[number];

const F = '```';
const code = (lang: string, body: string) => `${F}${lang}\n${body.trim()}\n${F}`;

const brl = (micros: string) => {
  const cents = BigInt(micros) / 10_000n;
  return `R$ ${cents / 100n},${(cents % 100n).toString().padStart(2, '0')}`;
};
const brlCents = (cents: number) => brl(String(BigInt(cents) * 10_000n));
/** "5.940000" -> "R$ 5,94"; keeps sub-cent digits ("0.154000" -> "R$ 0,154"). Exact, no floats. */
const perM = (decimal: string) => {
  const [whole = '0', frac = ''] = decimal.split('.');
  const digits = frac.replace(/0+$/, '').padEnd(2, '0');
  return `R$ ${whole},${digits}`;
};

const MODE_TEXT: Record<ProjectSnapshot['billingMode'], string> = {
  ORG_WALLET:
    'Carteira da organização (`ORG_WALLET`): todo consumo sai do saldo da organização. As chamadas à IA devem passar pelo backend do app (a chave secreta fica lá).',
  END_USER_WALLET:
    'Cobrar do usuário final (`END_USER_WALLET`): cada usuário do app tem saldo próprio, compra créditos via Pix e paga o que usa. Toda chamada de chat precisa identificar o usuário (session token ou header `X-Fuse-User`).',
  HYBRID:
    'Híbrido (`HYBRID`): consome primeiro o saldo do usuário final; quando acabar, a organização paga. Usuários compram créditos via Pix.',
};

function projectSection(p: ProjectSnapshot, urls: DocUrls) {
  const v1 = `${urls.api.replace(/\/+$/, '')}/v1`;
  const model = p.defaultModel ?? p.models[0]?.id ?? 'fuse/deepseek-chat';
  const models = p.models.length
    ? [
        '| Modelo | Nome | Entrada (R$/1M) | Saída (R$/1M) |',
        '|---|---|---|---|',
        ...p.models.map(
          (m) => `| \`${m.id}\` | ${m.name} | ${perM(m.input)} | ${perM(m.output)} |`,
        ),
      ].join('\n')
    : 'Nenhum modelo disponível no momento. Consulte `GET /v1/models`.';
  const packages = p.packages.length
    ? p.packages
        .map(
          (k) =>
            `- \`${k.id}\`: **${k.name}**, ${brlCents(k.priceCents)} → ${brl(String(BigInt(k.creditMicros) + BigInt(k.bonusMicros)))} em créditos`,
        )
        .join('\n')
    : p.billingMode === 'ORG_WALLET'
      ? '- (não se aplica: o projeto não vende créditos)'
      : '- Nenhum pacote ainda. Crie no painel (Projetos → Pacotes de créditos) ou com a tool MCP `create_package`.';

  return `## Dados do projeto “${p.name}”

- Base URL: \`${v1}\` (compatível com OpenAI)
- Servidor MCP: \`${urls.api.replace(/\/+$/, '')}/mcp\`
- Modo de cobrança: ${MODE_TEXT[p.billingMode]}
- Modelo padrão sugerido: \`${model}\`
- Origens permitidas para session token: ${p.allowedOrigins.length ? p.allowedOrigins.map((o) => `\`${o}\``).join(', ') : '**nenhuma** (cadastre a origem do front em Configurações → Origens permitidas)'}
- Webhook: ${p.webhookUrl ? `\`${p.webhookUrl}\`` : '**não configurado** (configure em Configurações → Webhook ou com `update_project_settings`)'}
${p.billingMode !== 'ORG_WALLET' ? `- Crédito grátis para usuário novo: ${brl(p.freeCreditMicros)}\n` : ''}
### Modelos liberados

${models}

### Pacotes de créditos

${packages}`;
}

const RULES = `## Regras (obrigatórias)

1. A chave secreta (\`fai_live_…\` / \`fai_test_…\`) fica **só no servidor**, em variável de ambiente (\`FUSAI_API_KEY\`). Nunca no front-end, no app mobile, no repositório ou em logs.
2. Front-end e apps usam **session token** (\`fai_st_…\`, 15 min) gerado pelo backend para o usuário **já autenticado** no app. Nunca gere token para um id vindo do cliente.
3. Dinheiro vem em **micro-reais** como texto (1 real = 1.000.000). Use inteiros (BigInt), nunca float.
4. Trate \`402 insufficient_funds\` mostrando a compra de créditos (ou avisando o admin, em \`ORG_WALLET\`).
5. Webhooks: valide \`X-Fuse-Signature\` com o corpo bruto e deduplique pelo \`id\` do evento.
6. Não registre em log o conteúdo das mensagens dos usuários.`;

function flowSection(p: ProjectSnapshot) {
  if (p.billingMode === 'ORG_WALLET') {
    return `## Fluxo de integração

1. Backend: crie uma rota (ex.: \`POST /api/chat\`) que recebe as mensagens do usuário autenticado e chama \`POST /v1/chat/completions\` com a chave secreta (SDK da OpenAI com \`baseURL\` da fusai). Para streaming, repasse o SSE.
2. Front: chama a rota do seu backend, nunca a fusai direto.
3. Opcional: limite de gasto mensal por chave no painel e webhook \`balance.low\` para avisar quando recarregar.`;
  }
  return `## Fluxo de integração

1. **Backend — usuário final**: no login (ou na primeira vez), \`POST /v1/app-users\` com \`{ externalId: <id do usuário no app>, name, email }\` (idempotente).
2. **Backend — session token**: rota autenticada (ex.: \`POST /api/fuse-session\`) que chama \`POST /v1/app-users/:externalId/session-token\` e devolve \`{ token, expiresAt }\`.
3. **Front/app — chat**: \`@fusai/sdk\` com \`sessionToken\` = função que chama a rota do passo 2. O consumo sai da carteira do usuário.
4. **Front/app — saldo e compra**: \`<FusaiBalance/>\` e \`<FusaiCheckout/>\` (React), ou \`POST /v1/checkout/pix\` + abrir \`hostedUrl\` (qualquer app). Na primeira compra o Pix exige CPF/CNPJ (\`document\`).
5. **Backend — webhook**: rota \`POST /api/webhooks/fusai\` que valida a assinatura e trata \`app_user.credited\` / \`payment.received\` (ex.: liberar recursos, notificar o usuário).
6. **Configuração**: cadastre a origem do front em Origens permitidas e a URL do webhook (painel ou \`update_project_settings\`).`;
}

function stackSection(stack: GuideStack, p: ProjectSnapshot, urls: DocUrls) {
  const v1 = `${urls.api.replace(/\/+$/, '')}/v1`;
  const model = p.defaultModel ?? p.models[0]?.id ?? 'fuse/deepseek-chat';
  const pkg = p.packages[0]?.id ?? 'PACOTE_ID';
  const endUser = p.billingMode !== 'ORG_WALLET';

  switch (stack) {
    case 'nextjs':
      return `### Next.js (App Router)

${code('bash', `npm i @fusai/sdk @fusai/react openai\n# .env.local\nFUSAI_API_KEY=fai_live_...\nFUSAI_BASE_URL=${v1}\nFUSAI_WEBHOOK_SECRET=whsec_...`)}

${
  endUser
    ? `\`app/api/fuse-session/route.ts\` (servidor):

${code(
  'ts',
  `
import { Fusai } from '@fusai/sdk';
import { getCurrentUser } from '@/lib/auth'; // sua autenticação

const fuse = new Fusai({ apiKey: process.env.FUSAI_API_KEY!, baseUrl: process.env.FUSAI_BASE_URL });

export async function POST() {
  const user = await getCurrentUser();
  if (!user) return new Response('não autenticado', { status: 401 });
  await fuse.appUsers.upsert({ externalId: user.id, name: user.name, email: user.email });
  const { token, expiresAt } = await fuse.appUsers.createSessionToken(user.id);
  return Response.json({ token, expiresAt });
}`,
)}

Componente (cliente):

${code(
  'tsx',
  `
'use client';
import { FusaiBalance, FusaiCheckout, FusaiProvider, useFusaiClient } from '@fusai/react';

const getToken = () => fetch('/api/fuse-session', { method: 'POST' }).then((r) => r.json()).then((d) => d.token);

export function Creditos() {
  return (
    <FusaiProvider sessionToken={getToken} baseUrl="${v1}">
      <p>Saldo: <FusaiBalance /></p>
      <FusaiCheckout packageId="${pkg}" onPaid={() => location.reload()} />
    </FusaiProvider>
  );
}

// Dentro do FusaiProvider:
export function useResposta() {
  const fuse = useFusaiClient();
  return async (pergunta: string, onDelta: (t: string) => void) => {
    for await (const chunk of fuse!.chat.completions.stream({ model: '${model}', messages: [{ role: 'user', content: pergunta }] })) {
      onDelta(chunk.choices[0]?.delta.content ?? '');
    }
  };
}`,
)}`
    : `\`app/api/chat/route.ts\` (servidor, streaming):

${code(
  'ts',
  `
import OpenAI from 'openai';
const client = new OpenAI({ apiKey: process.env.FUSAI_API_KEY, baseURL: process.env.FUSAI_BASE_URL });

export async function POST(req: Request) {
  const { messages } = await req.json(); // valide e autentique o usuário antes
  const stream = await client.chat.completions.create({ model: '${model}', messages, stream: true });
  const body = new ReadableStream({
    async start(controller) {
      for await (const chunk of stream) controller.enqueue(new TextEncoder().encode(chunk.choices[0]?.delta?.content ?? ''));
      controller.close();
    },
  });
  return new Response(body, { headers: { 'content-type': 'text/plain; charset=utf-8' } });
}`,
)}`
}

\`app/api/webhooks/fusai/route.ts\`:

${code(
  'ts',
  `
import { verifyWebhook } from '@fusai/sdk/server';

export async function POST(req: Request) {
  const raw = await req.text();
  const event = await verifyWebhook(process.env.FUSAI_WEBHOOK_SECRET!, req.headers.get('x-fuse-signature'), raw);
  if (!event) return new Response('assinatura inválida', { status: 401 });
  // deduplique por event.id e trate event.type ('app_user.credited', 'payment.received', 'balance.low'...)
  return Response.json({ ok: true });
}`,
)}`;

    case 'node':
      return `### Node.js (Express)

${code(
  'ts',
  `
import express from 'express';
import OpenAI from 'openai';
import { Fusai } from '@fusai/sdk';
import { verifyWebhook } from '@fusai/sdk/server';

const openai = new OpenAI({ apiKey: process.env.FUSAI_API_KEY, baseURL: '${v1}' });
const fuse = new Fusai({ apiKey: process.env.FUSAI_API_KEY!, baseUrl: '${v1}' });
const app = express();

app.post('/api/chat', express.json(), async (req, res) => {
  const r = await openai.chat.completions.create({ model: '${model}', messages: req.body.messages }${endUser ? `, { headers: { 'X-Fuse-User': req.user.id } }` : ''});
  res.json({ text: r.choices[0].message.content });
});
${
  endUser
    ? `
app.post('/api/fuse-session', async (req, res) => {
  await fuse.appUsers.upsert({ externalId: req.user.id, name: req.user.name });
  res.json(await fuse.appUsers.createSessionToken(req.user.id));
});
`
    : ''
}
app.post('/api/webhooks/fusai', express.text({ type: '*/*' }), async (req, res) => {
  const event = await verifyWebhook(process.env.FUSAI_WEBHOOK_SECRET!, req.get('x-fuse-signature'), req.body);
  if (!event) return res.status(401).end();
  res.json({ ok: true });
});`,
)}`;

    case 'python':
      return `### Python (FastAPI)

${code(
  'python',
  `
import hashlib, hmac, os, time
import httpx
from fastapi import FastAPI, Request, HTTPException
from openai import OpenAI

BASE = "${v1}"
KEY = os.environ["FUSAI_API_KEY"]
client = OpenAI(api_key=KEY, base_url=BASE)
app = FastAPI()

@app.post("/api/chat")
async def chat(body: dict, user=...):  # sua autenticação
    r = client.chat.completions.create(model="${model}", messages=body["messages"]${endUser ? ', extra_headers={"X-Fuse-User": user.id}' : ''})
    return {"text": r.choices[0].message.content}
${
  endUser
    ? `
@app.post("/api/fuse-session")
async def session(user=...):
    h = {"Authorization": f"Bearer {KEY}"}
    httpx.post(f"{BASE}/app-users", json={"externalId": user.id, "name": user.name}, headers=h).raise_for_status()
    return httpx.post(f"{BASE}/app-users/{user.id}/session-token", headers=h).json()
`
    : ''
}
@app.post("/api/webhooks/fusai")
async def webhook(req: Request):
    raw = await req.body()
    parts = dict(p.split("=", 1) for p in req.headers.get("x-fuse-signature", "").split(",") if "=" in p)
    t, v1 = parts.get("t"), parts.get("v1")
    expected = hmac.new(os.environ["FUSAI_WEBHOOK_SECRET"].encode(), f"{t}.".encode() + raw, hashlib.sha256).hexdigest()
    if not t or not v1 or abs(time.time() - int(t)) > 300 or not hmac.compare_digest(expected, v1):
        raise HTTPException(401)
    return {"ok": True}`,
)}`;

    case 'react-native':
      return `### React Native / Expo

O backend do app (qualquer stack) expõe \`POST /api/fuse-session\` (veja Node.js). No app:

${code(
  'tsx',
  `
import { Fusai, FusaiError, formatMicros } from '@fusai/sdk';
import * as WebBrowser from 'expo-web-browser';

const fuse = new Fusai({
  baseUrl: '${v1}',
  sessionToken: () => api.post('/api/fuse-session').then((r) => r.data.token), // seu backend, com o login do usuário
});

export async function perguntar(texto: string) {
  try {
    // React Native não tem streaming de fetch: use a resposta completa.
    const r = await fuse.chat.completions.create({ model: '${model}', messages: [{ role: 'user', content: texto }] });
    return r.choices[0].message.content;
  } catch (e) {
    if (e instanceof FusaiError && e.code === 'insufficient_funds') await comprar();
    throw e;
  }
}

export async function comprar() {
  const c = await fuse.checkout.createPix({ packageId: '${pkg}', returnUrl: 'meuapp://creditos' });
  await WebBrowser.openBrowserAsync(c.hostedUrl); // página Pix da fusai
  const final = await fuse.checkout.get(c.checkoutId);
  return final.status === 'RECEIVED';
}

export const saldo = async () => formatMicros((await fuse.balance()).available_micros);`,
)}

Na primeira compra, envie \`document\` (CPF) e \`name\` em \`createPix\`, ou trate \`document_required\` pedindo o CPF. Confira as regras da loja (Apple/Google) para venda de créditos digitais.`;

    case 'flutter':
      return `### Flutter

${code(
  'dart',
  `
import 'dart:convert';
import 'package:http/http.dart' as http;
import 'package:url_launcher/url_launcher.dart';

const base = '${v1}';

/// Token vem do SEU backend (rota autenticada que chama /v1/app-users/:id/session-token).
Future<String> sessionToken() async {
  final r = await http.post(Uri.parse('https://seu-backend/api/fuse-session'), headers: authHeaders());
  return jsonDecode(r.body)['token'];
}

Future<String> perguntar(String texto) async {
  final r = await http.post(Uri.parse('$base/chat/completions'),
      headers: {'Authorization': 'Bearer \${await sessionToken()}', 'Content-Type': 'application/json'},
      body: jsonEncode({'model': '${model}', 'messages': [{'role': 'user', 'content': texto}]}));
  final body = jsonDecode(utf8.decode(r.bodyBytes));
  if (r.statusCode == 402) throw Exception('sem_saldo');
  return body['choices'][0]['message']['content'];
}

Future<void> comprar() async {
  final r = await http.post(Uri.parse('$base/checkout/pix'),
      headers: {'Authorization': 'Bearer \${await sessionToken()}', 'Content-Type': 'application/json'},
      body: jsonEncode({'packageId': '${pkg}', 'returnUrl': 'meuapp://creditos'}));
  final c = jsonDecode(r.body);
  await launchUrl(Uri.parse(c['hostedUrl']), mode: LaunchMode.externalApplication);
}`,
)}

Saldo: \`GET /v1/balance\` → \`available_micros\` (texto; divida por 1.000.000 com inteiros). Guarde o token até \`expiresAt\`.`;

    case 'laravel':
      return `### Laravel (PHP)

${code(
  'php',
  `
use Illuminate\\Http\\Request;
use Illuminate\\Support\\Facades\\Http;

// config/services.php: 'fusai' => ['key' => env('FUSAI_API_KEY'), 'url' => '${v1}', 'webhook_secret' => env('FUSAI_WEBHOOK_SECRET')]

function fuse() {
    return Http::withToken(config('services.fusai.key'))->baseUrl(config('services.fusai.url'));
}

Route::post('/api/chat', function (Request $req) {
    $r = fuse()${endUser ? "->withHeaders(['X-Fuse-User' => (string) $req->user()->id])" : ''}->post('/chat/completions', [
        'model' => '${model}',
        'messages' => $req->input('messages'),
    ])->throw()->json();
    return ['text' => $r['choices'][0]['message']['content']];
})->middleware('auth');
${
  endUser
    ? `
Route::post('/api/fuse-session', function (Request $req) {
    $u = $req->user();
    fuse()->post('/app-users', ['externalId' => (string) $u->id, 'name' => $u->name])->throw();
    return fuse()->post("/app-users/{$u->id}/session-token")->throw()->json();
})->middleware('auth');
`
    : ''
}
Route::post('/api/webhooks/fusai', function (Request $req) {
    parse_str(str_replace(',', '&', $req->header('X-Fuse-Signature', '')), $sig);
    $raw = $req->getContent();
    $expected = hash_hmac('sha256', ($sig['t'] ?? '') . '.' . $raw, config('services.fusai.webhook_secret'));
    abort_unless(isset($sig['v1']) && hash_equals($expected, $sig['v1']) && abs(time() - (int) $sig['t']) <= 300, 401);
    $event = json_decode($raw, true); // deduplique por $event['id']
    return ['ok' => true];
});`,
)}`;
  }
}

const CHECKLIST = (p: ProjectSnapshot) => `## Checklist de testes

- [ ] \`FUSAI_API_KEY\` só em variável de ambiente do servidor (procure \`fai_live_\` no código do front: não pode existir).
- [ ] Chat responde e o consumo aparece em Logs no painel.
${
  p.billingMode !== 'ORG_WALLET'
    ? `- [ ] Usuário novo é criado com \`POST /v1/app-users\` e recebe o crédito grátis.
- [ ] O front usa session token; a origem do front está em Origens permitidas.
- [ ] Sem saldo, o app mostra a compra (\`402 insufficient_funds\`).
- [ ] Compra Pix: QR aparece, após pagar o saldo sobe (\`create_test_checkout\` com chave de teste no sandbox).
`
    : '- [ ] O front nunca chama a fusai direto (só o seu backend).\n'
}- [ ] Webhook recebe \`test.ping\` (tool \`send_test_webhook\`) e rejeita assinatura inválida.
- [ ] Erros 429/5xx são tratados com nova tentativa; 4xx mostram mensagem amigável.`;

/** Markdown guide for one project (MCP `get_integration_guide`). */
export function integrationGuide(p: ProjectSnapshot, urls: DocUrls, stack?: GuideStack): string {
  const stacks = stack ? [stack] : (['nextjs', 'node'] as GuideStack[]);
  return `# Integração fusai — ${p.name}

${projectSection(p, urls)}

${RULES}

${flowSection(p)}

## Código

${stacks.map((s) => stackSection(s, p, urls)).join('\n\n')}
${stack ? '' : `\nOutras stacks: chame \`get_integration_guide\` com \`stack\` = ${GUIDE_STACKS.map((s) => `\`${s}\``).join(', ')}.\n`}
${CHECKLIST(p)}

Referência completa: recursos MCP \`fusai://docs/api\`, \`fusai://docs/sdk\`, \`fusai://docs/checkout\`.
`;
}

/** FUSAI.md: instructions file for the customer's coding AI (project root). No secrets. */
export function fusaiMd(p: ProjectSnapshot, urls: DocUrls): string {
  const api = urls.api.replace(/\/+$/, '');
  return `# FUSAI.md — instruções para a IA de programação

Este projeto usa a **fusai** (${api}/v1), gateway de IA compatível com a API da OpenAI, com cobrança em reais e Pix.
Siga estas instruções ao implementar ou alterar qualquer integração com IA ou pagamentos de créditos.

Se o MCP \`fusai\` estiver conectado, use as tools: \`get_integration_guide\` (guia com código para a stack do projeto), \`get_project_config\`, \`list_models\`, \`test_chat\`, \`send_test_webhook\`${p.billingMode !== 'ORG_WALLET' ? ', `list_packages`, `create_test_checkout`' : ''}.

${projectSection(p, urls)}

${RULES}

## Variáveis de ambiente (servidor)

${code('bash', `FUSAI_API_KEY=fai_live_...        # painel → Projetos → Chaves de API\nFUSAI_BASE_URL=${api}/v1\nFUSAI_WEBHOOK_SECRET=whsec_...     # painel → Configurações → Webhook`)}

${flowSection(p)}

## Endpoints

| Método | Rota | Credencial | Uso |
|---|---|---|---|
| POST | \`/v1/chat/completions\` | chave ou session token | Chat (OpenAI), \`stream: true\` para SSE |
| GET | \`/v1/models\` | chave ou session token | Modelos e preços (BRL/1M tokens) |
| GET | \`/v1/balance\` | chave ou session token | Saldo (\`available_micros\`) |
| POST | \`/v1/app-users\` | chave | Upsert do usuário final \`{ externalId, name?, email?, document? }\` |
| POST | \`/v1/app-users/:externalId/session-token\` | chave | \`{ token, expiresAt }\` (15 min) |
| GET | \`/v1/packages\` | chave ou session token | Pacotes de créditos |
| POST | \`/v1/checkout/pix\` | chave (+ \`externalId\`) ou session token | \`{ packageId, document?, name?, returnUrl? }\` → \`{ checkoutId, copyPaste, qrBase64, expiresAt, hostedUrl }\` |
| GET | \`/v1/checkout/:checkoutId\` | chave ou session token | Status (\`PENDING\`, \`RECEIVED\`, \`EXPIRED\`…) |

Header \`X-Fuse-User: <externalId>\` (com a chave secreta) cobra e consulta em nome de um usuário final.

## Webhooks

\`POST\` JSON \`{ id, type, created, data }\` com \`X-Fuse-Signature: t=<unix>,v1=<hmac_sha256(segredo, t + "." + corpo_bruto)>\`.
Eventos: \`payment.received\`, \`app_user.credited\`, \`payment.expired\`, \`payment.refunded\`, \`balance.low\`, \`usage.limit_reached\`, \`test.ping\`.
Responda 2xx em até 10 s; novas tentativas em 1 min, 5 min, 30 min, 2 h e 12 h. Deduplique por \`id\`.

## Erros comuns

\`401 invalid_api_key\` · \`402 insufficient_funds\` · \`403 origin_not_allowed\` (cadastre a origem) · \`403 secret_key_in_browser\` (use session token) · \`400 app_user_required\` · \`400 document_required\` (CPF na 1ª compra) · \`429 rate_limited\` (respeite \`retry-after\`).

## Exemplo base (${p.billingMode === 'ORG_WALLET' ? 'Node.js' : 'Next.js'})

${stackSection(p.billingMode === 'ORG_WALLET' ? 'node' : 'nextjs', p, urls)}

${CHECKLIST(p)}

Docs: ${urls.app.replace(/\/+$/, '')}/docs · Texto para IAs: ${urls.app.replace(/\/+$/, '')}/llms-full.txt
`;
}
