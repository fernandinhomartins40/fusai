# @fusai/react

Componentes React da [fusai](https://www.fusai.com.br) para compra de créditos via Pix, recarga e saldo. Usa o [`@fusai/sdk`](https://www.npmjs.com/package/@fusai/sdk).

```bash
npm i @fusai/react @fusai/sdk
```

Requer React 18 ou mais recente. Os componentes são de cliente (`'use client'`) e funcionam no Next.js App Router.

## Uso

```tsx
import { FusaiBalance, FusaiCheckout, FusaiProvider } from '@fusai/react';

export function Creditos({ sessionToken }: { sessionToken: string }) {
  return (
    <FusaiProvider sessionToken={sessionToken}>
      <FusaiBalance refreshIntervalMs={30_000} />
      <FusaiCheckout onPaid={() => console.log('pago!')} />
    </FusaiProvider>
  );
}
```

| Componente | Para que serve |
|---|---|
| `<FusaiProvider sessionToken baseUrl?>` | Compartilha o cliente entre os componentes (`useFusaiClient()` dá acesso a ele). |
| `<FusaiCheckout packageId? onPaid onExpired />` | Compra via Pix completa: pacotes, CPF/CNPJ, QR Code, copia e cola, status e sucesso. |
| `<FusaiBalance refreshKey? refreshIntervalMs? />` | Saldo do usuário, formatado em reais. |
| `<FusaiTopup endpoint? amounts? onPaid? />` | Recarga dos créditos da sua própria conta, usando as rotas de `fusaiAccountHandler` (`@fusai/sdk/server`), por padrão em `/api/fusai`. |

## Estilo

Ajuste o visual com estas variáveis CSS:

- `--fusai-accent`
- `--fusai-fg`
- `--fusai-muted`
- `--fusai-border`
- `--fusai-bg`
- `--fusai-radius`

Documentação completa: https://www.fusai.com.br/docs/sdks
