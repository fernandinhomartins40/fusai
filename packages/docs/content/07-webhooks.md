# Webhooks

> A fusai avisa o seu servidor quando um Pix cai, expira ou é estornado, e quando o saldo fica baixo. Toda entrega é assinada.

## Configurar

Em **Projetos → Configurações → Webhook**, informe a URL (https em produção). O segredo de assinatura `whsec_…` é gerado na hora; revele ou rotacione ali mesmo. Em **Webhooks** você vê o histórico de entregas, reenvia e dispara um evento de teste.

## Formato

`POST` com corpo JSON:

```json
{
  "id": "evt_8f2c...",
  "type": "app_user.credited",
  "created": "2026-10-14T20:52:45.123Z",
  "data": {
    "payment": { "id": "...", "checkoutId": "chk_...", "status": "RECEIVED", "amountCents": 990, "creditMicros": "10000000", "packageId": "..." },
    "appUser": { "id": "...", "externalId": "usuario-123", "balanceMicros": "10500000" }
  }
}
```

Headers: `X-Fuse-Event` (tipo), `X-Fuse-Delivery` (id da entrega) e `X-Fuse-Signature`.

## Eventos

| Tipo | Quando |
|---|---|
| `payment.received` | Pix confirmado (checkout de usuário final do projeto). |
| `app_user.credited` | Créditos entraram na carteira de um usuário final. |
| `payment.expired` | Pix não pago no prazo. |
| `payment.refunded` | Pagamento estornado (créditos removidos). |
| `balance.low` | Saldo da organização abaixo do alerta (no máximo 1×/dia). `data`: `availableMicros`, `thresholdMicros`. |
| `usage.limit_reached` | Uma chave atingiu o limite de gasto mensal (no máximo 1×/dia). |
| `test.ping` | Botão “Enviar evento de teste”. |

## Verificar a assinatura

`X-Fuse-Signature: t=<unix>,v1=<hex>`, onde `v1 = HMAC-SHA256(segredo, t + "." + corpo_bruto)`. Use o **corpo bruto** (antes de fazer parse do JSON) e rejeite timestamps com mais de 5 minutos.

Node / Next.js (com o SDK):

```ts
import { verifyWebhook } from '@fusai/sdk/server';

export async function POST(req: Request) {
  const raw = await req.text();
  const event = await verifyWebhook(process.env.FUSAI_WEBHOOK_SECRET!, req.headers.get('x-fuse-signature'), raw);
  if (!event) return new Response('assinatura inválida', { status: 401 });
  if (await jaProcessado(event.id)) return Response.json({ ok: true }); // idempotência
  // ... trate event.type
  return Response.json({ ok: true });
}
```

Python:

```python
import hmac, hashlib, time

def verificar(segredo: str, assinatura: str, corpo: bytes) -> bool:
    partes = dict(p.split("=", 1) for p in assinatura.split(","))
    t, v1 = partes.get("t"), partes.get("v1")
    if not t or not v1 or abs(time.time() - int(t)) > 300:
        return False
    esperado = hmac.new(segredo.encode(), f"{t}.".encode() + corpo, hashlib.sha256).hexdigest()
    return hmac.compare_digest(esperado, v1)
```

## Entrega e novas tentativas

- Sucesso = qualquer resposta 2xx em até 10 segundos. Responda rápido e processe depois.
- Falhou? Novas tentativas em 1 min, 5 min, 30 min, 2 h e 12 h (6 no total). Depois disso fica como “falhou” no painel, com botão de reenviar.
- Redirects não são seguidos.
- A mesma entrega pode chegar mais de uma vez: **use `id` para não processar em dobro.**
