# SDKs

> Use o SDK oficial da OpenAI no servidor, `@fusai/sdk` em qualquer runtime JavaScript e `@fusai/react` para checkout, recarga e saldo prontos.

Créditos da sua própria conta dentro do seu sistema (`fuse.topups`, `fusaiAccountHandler` e `<FusaiTopup/>`): veja [Créditos da sua conta](/docs/creditos-da-conta).

## SDK da OpenAI (qualquer linguagem)

A API é compatível: troque `baseURL` para `{{V1}}` e use a chave fusai. Funciona com os SDKs oficiais (Node, Python, .NET, Go, Java), LangChain, Vercel AI SDK (provider `openai-compatible`) e afins.

```ts
// Vercel AI SDK
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';

const fuse = createOpenAICompatible({ name: 'fusai', baseURL: '{{V1}}', apiKey: process.env.FUSAI_API_KEY });
```

## @fusai/sdk

Cliente TypeScript sem dependências: browser, Node 18+, Deno, Bun e React Native.

```bash
npm i @fusai/sdk
```

```ts
import { Fusai, FusaiError, formatMicros } from '@fusai/sdk';

// Servidor (chave secreta)
const server = new Fusai({ apiKey: process.env.FUSAI_API_KEY!, baseUrl: '{{V1}}' });
await server.appUsers.upsert({ externalId: 'usuario-123' });
const { token } = await server.appUsers.createSessionToken('usuario-123');

// Navegador / app (session token)
const fuse = new Fusai({ sessionToken: token, baseUrl: '{{V1}}' });
try {
  const res = await fuse.chat.completions.create({ model: 'fuse/auto', messages: [{ role: 'user', content: 'Oi' }] });
  const { available_micros } = await fuse.balance();
  console.log(res.choices[0].message.content, formatMicros(available_micros));
} catch (err) {
  if (err instanceof FusaiError && err.code === 'insufficient_funds') abrirCheckout();
}
```

Métodos: `chat.completions.create`, `chat.completions.stream`, `models`, `balance`, `packages`, `checkout.createPix`, `checkout.get`, `checkout.waitForPayment`, `appUsers.upsert`, `appUsers.get`, `appUsers.createSessionToken`.
Em `@fusai/sdk/server`: `verifyWebhook(segredo, assinatura, corpoBruto)`.

`sessionToken` também aceita uma função assíncrona: o SDK chama de novo quando o token expira (e faz uma única chamada mesmo com vários pedidos simultâneos).

## @fusai/react

```bash
npm i @fusai/react @fusai/sdk
```

- `<FusaiProvider sessionToken baseUrl>`: compartilha o cliente.
- `<FusaiCheckout packageId? onPaid onExpired />`: compra via Pix completa (pacotes, CPF, QR, status, sucesso).
- `<FusaiBalance refreshKey refreshIntervalMs />`: saldo formatado do usuário.

Estilo por variáveis CSS: `--fusai-accent`, `--fusai-fg`, `--fusai-muted`, `--fusai-border`, `--fusai-bg`, `--fusai-radius`.

## Outras linguagens

Flutter, Swift, Kotlin, PHP: chame a API REST direto (veja [Chat](/docs/chat), [Usuários finais](/docs/usuarios-finais) e [Checkout Pix](/docs/checkout-pix)). Valores de dinheiro vêm como texto em micro-reais: converta com aritmética inteira.
