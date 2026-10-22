# Checkout Pix

> Seus usuários compram pacotes de créditos com Pix dentro do seu app: página hospedada, componente React ou API.

## Antes de começar

1. Projeto em **Cobrar do usuário final** ou **Híbrido**.
2. Crie os pacotes em **Projetos → Pacotes de créditos**: preço (mínimo R$ 5), créditos (no máximo o valor do preço) e bônus. A diferença entre o preço e os créditos é a sua margem. O bônus é um presente seu: a cada venda ele sai do saldo da sua organização (sem saldo, o comprador recebe só os créditos).
3. Configure o [webhook](/docs/webhooks) para saber quando o pagamento caiu.

Na primeira compra, o Pix exige **CPF ou CNPJ** de quem paga: envie `document` (e `name`) ou deixe o componente pedir.

## Opção 1 — Página hospedada (qualquer app: web, PWA, WebView, nativo)

```bash
curl -X POST {{V1}}/checkout/pix \
  -H "Authorization: Bearer $FUSAI_API_KEY" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: compra-usuario-123-001" \
  -d '{"externalId": "usuario-123", "packageId": "PACOTE_ID", "document": "52998224725", "name": "Maria", "returnUrl": "meuapp://compra-ok"}'
```

```json
{
  "checkoutId": "chk_...",
  "status": "PENDING",
  "amountCents": 990,
  "copyPaste": "000201...",
  "qrBase64": "iVBOR...",
  "expiresAt": "...",
  "hostedUrl": "{{APP}}/pay/chk_..."
}
```

Abra `hostedUrl` no navegador (ou no navegador interno do app). A página mostra QR Code, copia e cola, contagem e status ao vivo; quando o Pix cai, mostra o sucesso e o botão **Voltar ao app** (`returnUrl`, ou `?return_url=` na URL: https ou deep link; `javascript:` e afins são bloqueados).

## Opção 2 — Componente React

```tsx
import { FusaiCheckout, FusaiBalance, FusaiProvider } from '@fusai/react';

const getToken = () => fetch('/api/fuse-session', { method: 'POST' }).then((r) => r.json()).then((d) => d.token);

export function Loja() {
  return (
    <FusaiProvider sessionToken={getToken} baseUrl="{{V1}}">
      <p>Saldo: <FusaiBalance /></p>
      <FusaiCheckout onPaid={(c) => console.log('pago!', c.checkoutId)} />
    </FusaiProvider>
  );
}
```

Sem `packageId`, o componente lista os pacotes; com `packageId`, vai direto ao Pix. Personalize as cores com variáveis CSS (`--fusai-accent`, `--fusai-bg`, `--fusai-radius`…).

## Opção 3 — SDK ou REST (sua própria tela)

```ts
const checkout = await fuse.checkout.createPix({ packageId, document: cpf, name });
mostrarQr(checkout.qrBase64, checkout.copyPaste);
const final = await fuse.checkout.waitForPayment(checkout.checkoutId); // polling a cada 3 s
if (final.status === 'RECEIVED') atualizarSaldo();
```

Em Flutter, Swift ou Kotlin: `POST /v1/checkout/pix` e `GET /v1/checkout/:checkoutId` com o session token no header `Authorization`.

## Status

| Status | Significado |
|---|---|
| `PENDING` | Aguardando o Pix (vale 60 minutos). |
| `RECEIVED` / `CONFIRMED` | Pago: créditos + bônus já estão na carteira do usuário. |
| `EXPIRED` / `CANCELED` | Não foi pago a tempo. Gere outro. |
| `REFUNDED` | Estornado: os créditos foram removidos. |

## Apps nas lojas (iOS e Android)

Vender créditos digitais dentro de apps de loja tem regras próprias. No Brasil, desde junho de 2026 (iOS 26.5), a Apple permite meios de pagamento alternativos e links externos em apps da App Store, com comissões próprias para essas modalidades. O Google Play tem política própria. Você é responsável por verificar as regras da sua loja; a fusai fornece o checkout hospedado e o SDK.
