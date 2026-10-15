# SDKs

> Use o SDK oficial da OpenAI no servidor, `@fuseai/sdk` em qualquer runtime JavaScript e `@fuseai/react` para checkout e saldo prontos.

## SDK da OpenAI (qualquer linguagem)

A API é compatível: troque `baseURL` para `{{V1}}` e use a chave FuseAI. Funciona com os SDKs oficiais (Node, Python, .NET, Go, Java), LangChain, Vercel AI SDK (provider `openai-compatible`) e afins.

```ts
// Vercel AI SDK
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';

const fuse = createOpenAICompatible({ name: 'fuseai', baseURL: '{{V1}}', apiKey: process.env.FUSEAI_API_KEY });
```

## @fuseai/sdk

Cliente TypeScript sem dependências: browser, Node 18+, Deno, Bun e React Native.

```bash
npm i @fuseai/sdk
```

```ts
import { FuseAI, FuseAIError, formatMicros } from '@fuseai/sdk';

// Servidor (chave secreta)
const server = new FuseAI({ apiKey: process.env.FUSEAI_API_KEY!, baseUrl: '{{V1}}' });
await server.appUsers.upsert({ externalId: 'usuario-123' });
const { token } = await server.appUsers.createSessionToken('usuario-123');

// Navegador / app (session token)
const fuse = new FuseAI({ sessionToken: token, baseUrl: '{{V1}}' });
try {
  const res = await fuse.chat.completions.create({ model: 'fuse/deepseek-chat', messages: [{ role: 'user', content: 'Oi' }] });
  const { available_micros } = await fuse.balance();
  console.log(res.choices[0].message.content, formatMicros(available_micros));
} catch (err) {
  if (err instanceof FuseAIError && err.code === 'insufficient_funds') abrirCheckout();
}
```

Métodos: `chat.completions.create`, `chat.completions.stream`, `models`, `balance`, `packages`, `checkout.createPix`, `checkout.get`, `checkout.waitForPayment`, `appUsers.upsert`, `appUsers.get`, `appUsers.createSessionToken`.
Em `@fuseai/sdk/server`: `verifyWebhook(segredo, assinatura, corpoBruto)`.

`sessionToken` também aceita uma função assíncrona: o SDK chama de novo quando o token expira (e faz uma única chamada mesmo com vários pedidos simultâneos).

## @fuseai/react

```bash
npm i @fuseai/react @fuseai/sdk
```

- `<FuseProvider sessionToken baseUrl>`: compartilha o cliente.
- `<FuseCheckout packageId? onPaid onExpired />`: compra via Pix completa (pacotes, CPF, QR, status, sucesso).
- `<FuseBalance refreshKey refreshIntervalMs />`: saldo formatado do usuário.

Estilo por variáveis CSS: `--fuse-accent`, `--fuse-fg`, `--fuse-muted`, `--fuse-border`, `--fuse-bg`, `--fuse-radius`.

## Outras linguagens

Flutter, Swift, Kotlin, PHP: chame a API REST direto (veja [Chat](/docs/chat), [Usuários finais](/docs/usuarios-finais) e [Checkout Pix](/docs/checkout-pix)). Valores de dinheiro vêm como texto em micro-reais: converta com aritmética inteira.
