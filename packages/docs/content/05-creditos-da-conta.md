# Créditos da sua conta

> Uso próprio: veja o saldo, o consumo e adicione créditos com Pix de dentro do seu sistema, sem abrir o painel da fusai.

Quando o seu sistema usa IA para você mesmo (modo **Carteira da organização**), todo consumo sai do saldo da sua organização. Você pode recarregar no painel (Carteira) ou colocar uma página de créditos na área de administração do seu sistema.

A chave secreta fica **só no servidor**. A tela do seu sistema fala com rotas do seu backend, protegidas pelo login de admin, e o backend fala com a fusai.

## Rotas

Chave secreta com os escopos `billing:read` (saldo e consumo) e `checkout` (recargas). Não envie `X-Fuse-User`: é o saldo da organização.

| Método | Rota | Resposta |
|---|---|---|
| GET | `/v1/balance` | Saldo da organização (`available_micros`). |
| GET | `/v1/usage?from=&to=` | Consumo do projeto por modelo (padrão: 30 dias). |
| GET | `/v1/topup-options` | `minAmountCents` (R$ 5,00), `maxAmountCents`, `feePct`, `packages` e `available`. |
| POST | `/v1/topups` | Gera o Pix. Corpo `{ "amountCents": 5000 }` ou `{ "packageId": "..." }`, opcional `returnUrl`. |
| GET | `/v1/topups/:id` | Status da recarga. |
| GET | `/v1/topups` | Últimas 20 recargas. |

```bash
curl -X POST {{V1}}/topups \
  -H "Authorization: Bearer $FUSAI_API_KEY" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: recarga-2026-10-18-001" \
  -d '{"amountCents": 5000}'
```

```json
{
  "object": "topup",
  "checkoutId": "chk_...",
  "status": "PENDING",
  "amountCents": 5000,
  "creditMicros": "50000000",
  "copyPaste": "000201...",
  "qrBase64": "iVBOR...",
  "expiresAt": "...",
  "hostedUrl": "{{APP}}/pay/chk_..."
}
```

Mostre o QR (`data:image/png;base64,` + `qrBase64`) e o copia e cola, ou abra `hostedUrl`. Consulte `GET /v1/topups/:id` a cada 3 segundos: quando o status vira `RECEIVED`, os créditos já estão no saldo. O Pix vale 60 minutos e tem mínimo de R$ 5,00. A organização precisa ter CPF ou CNPJ cadastrado (painel → Configurações).

## Pronto para Next.js e React

O `@fusai/sdk/server` traz as rotas seguras e o `@fusai/react` traz a tela (saldo, valores, Pix, status ao vivo).

```ts
// app/api/fusai/[...path]/route.ts
import { Fusai } from '@fusai/sdk';
import { fusaiAccountHandler } from '@fusai/sdk/server';

const fuse = new Fusai({ apiKey: process.env.FUSAI_API_KEY!, baseUrl: '{{V1}}' });

const handler = fusaiAccountHandler(fuse, {
  basePath: '/api/fusai',
  // Obrigatório: só o admin do seu sistema vê o saldo e gera recargas.
  authorize: async () => (await getCurrentUser())?.isAdmin === true,
});
export { handler as GET, handler as POST };
```

```tsx
// app/admin/creditos/page.tsx
'use client';
import { FusaiTopup } from '@fusai/react';

export default function Creditos() {
  return <FusaiTopup endpoint="/api/fusai" />;
}
```

`fusaiAccountHandler` usa a API padrão de `Request`/`Response`: funciona também em Remix, Hono, Bun, Deno e edge. Em Express, Laravel, Django ou outros, crie as rotas equivalentes repassando para a tabela acima.

No SDK, direto no servidor:

```ts
const saldo = await fuse.balance();
const consumo = await fuse.usage({ from: '2026-10-01' });
const recarga = await fuse.topups.create({ amountCents: 5000 });
const final = await fuse.topups.waitForPayment(recarga.checkoutId); // RECEIVED = pago
```

## Com a sua IA

Conecte o [MCP](/docs/mcp) com uma chave de agente e peça: *"Configure a fusai para uso próprio neste sistema e crie uma página de créditos na área de admin."*

## Se um dia for revender

Nada precisa ser refeito. Mude o modo de cobrança do projeto para **Híbrido** ou **Cobrar do usuário final** e implemente a compra pelos usuários ([Usuários finais](/docs/usuarios-finais) e [Checkout Pix](/docs/checkout-pix)). A página de créditos da sua conta continua funcionando.
