# @fusai/sdk

Cliente TypeScript da [fusai](https://www.fusai.com.br), o gateway de IA compatível com OpenAI feito para o Brasil. Não tem dependências e roda no navegador, Node 18+, Deno, Bun e React Native.

```bash
npm i @fusai/sdk
```

## Uso

```ts
import { Fusai, FusaiError, formatMicros } from '@fusai/sdk';

// No servidor, com a chave secreta
const server = new Fusai({ apiKey: process.env.FUSAI_API_KEY! });
await server.appUsers.upsert({ externalId: 'usuario-123' });
const { token } = await server.appUsers.createSessionToken('usuario-123');

// No navegador ou no app, com session token
const fuse = new Fusai({ sessionToken: token });
try {
  const res = await fuse.chat.completions.create({
    model: 'fuse/auto',
    messages: [{ role: 'user', content: 'Oi' }],
  });
  const { available_micros } = await fuse.balance();
  console.log(res.choices[0].message.content, formatMicros(available_micros));
} catch (err) {
  if (err instanceof FusaiError && err.code === 'insufficient_funds') {
    // abra o checkout Pix
  }
}
```

A URL padrão é `https://api.fusai.com.br/v1`. Para mudar, passe `baseUrl`.

`sessionToken` também aceita uma função assíncrona. O SDK chama essa função de novo quando o token expira, e faz uma única chamada mesmo com vários pedidos ao mesmo tempo.

### Principais métodos

| Área | Métodos |
|---|---|
| Chat e modelos | `chat.completions.create`, `chat.completions.stream`, `models` |
| Saldo e consumo | `balance`, `usage` |
| Checkout Pix | `packages`, `checkout.createPix`, `checkout.get`, `checkout.waitForPayment` |
| Créditos da conta | `topups.options`, `topups.create`, `topups.get`, `topups.list`, `topups.waitForPayment` |
| Usuários finais | `appUsers.upsert`, `appUsers.get`, `appUsers.createSessionToken` |

Valores de dinheiro vêm em micro-reais (1 BRL = 1.000.000), como texto ou `bigint`. Use `formatMicros` para exibir.

## Servidor: webhooks e créditos da conta

```ts
import { verifyWebhook, fusaiAccountHandler } from '@fusai/sdk/server';

const event = await verifyWebhook(process.env.FUSAI_WEBHOOK_SECRET!, signatureHeader, rawBody);
```

`fusaiAccountHandler(fuse, { authorize })` monta rotas prontas, no formato Request/Response, para a tela de créditos da sua conta.

## Módulos

O pacote é publicado em ESM e CommonJS, com tipos (`.d.ts` e `.d.cts`).

Documentação completa: https://www.fusai.com.br/docs/sdks
