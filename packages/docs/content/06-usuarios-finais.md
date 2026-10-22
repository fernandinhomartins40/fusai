# Usuários finais e session token

> Deixe os usuários do seu app terem saldo próprio, comprarem créditos com Pix e usarem a IA direto do front-end, sem expor sua chave.

## Modos de cobrança do projeto

Em **Projetos → Configurações → Modo de cobrança**:

| Modo | Quem paga o consumo |
|---|---|
| Carteira da organização (`ORG_WALLET`) | Sua organização paga tudo. |
| Cobrar do usuário final (`END_USER_WALLET`) | Cada usuário do seu app tem saldo próprio e paga o que usa. |
| Híbrido (`HYBRID`) | Primeiro o saldo do usuário; quando acabar, sua organização paga (bom para freemium). |

Você pode dar **crédito grátis inicial** a cada usuário novo (Configurações → Crédito grátis). Esse crédito sai do saldo da sua organização: sem saldo, o usuário é criado sem ele e a resposta de `POST /v1/app-users` traz `"freeCredit": "insufficient_org_balance"`. Cortesias dadas pelo painel também saem do saldo da organização.

## 1. Crie (ou atualize) o usuário final, no seu backend

```bash
curl -X POST {{V1}}/app-users \
  -H "Authorization: Bearer $FUSAI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"externalId": "usuario-123", "name": "Maria", "email": "maria@exemplo.com"}'
```

`externalId` é o id do usuário no **seu** sistema. A chamada é idempotente (upsert): chame no login. Resposta:

```json
{ "id": "...", "externalId": "usuario-123", "balanceMicros": "500000", "availableMicros": "500000", "createdAt": "..." }
```

Valores em **micro-reais** (1 real = 1.000.000) e em texto.

## 2. Gere um session token e entregue ao front

```ts
// Rota do SEU backend, ex.: POST /api/fuse-session (usuário já autenticado no seu app)
import { Fusai } from '@fusai/sdk';

const fuse = new Fusai({ apiKey: process.env.FUSAI_API_KEY!, baseUrl: '{{V1}}' });

export async function POST() {
  const user = await getCurrentUser(); // sua autenticação
  await fuse.appUsers.upsert({ externalId: user.id, name: user.name });
  const { token, expiresAt } = await fuse.appUsers.createSessionToken(user.id);
  return Response.json({ token, expiresAt });
}
```

## 3. Use no navegador ou no app

```ts
import { Fusai } from '@fusai/sdk';

const fuse = new Fusai({
  baseUrl: '{{V1}}',
  // Função: o SDK pede um token novo sozinho quando o atual expira.
  sessionToken: () => fetch('/api/fuse-session', { method: 'POST' }).then((r) => r.json()).then((d) => d.token),
});

const saldo = await fuse.balance(); // saldo DO USUÁRIO
for await (const chunk of fuse.chat.completions.stream({
  model: 'fuse/auto',
  messages: [{ role: 'user', content: 'Oi!' }],
})) {
  console.log(chunk.choices[0]?.delta.content ?? '');
}
```

O consumo sai da carteira do usuário. Sem saldo: `402 insufficient_funds`. Mostre então o [checkout Pix](/docs/checkout-pix).

## Rotas

| Método | Rota | Credencial |
|---|---|---|
| POST | `/v1/app-users` | chave secreta (`app_users`) |
| GET | `/v1/app-users/:externalId` | chave secreta (`app_users`) |
| POST | `/v1/app-users/:externalId/session-token` | chave secreta (`app_users`) |
| GET | `/v1/balance` | session token, ou chave + `X-Fuse-User` |
| POST | `/v1/chat/completions` | session token, ou chave + `X-Fuse-User` |

## Checklist de segurança

- A chave `fai_live_` só existe no servidor.
- O session token é gerado para o usuário **autenticado** no seu app, nunca para um `externalId` vindo do cliente.
- Cadastre as origens do seu front em **Origens permitidas**.
