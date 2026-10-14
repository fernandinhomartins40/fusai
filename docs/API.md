# API FuseAI

Base: `http://localhost:4000` (dev) · `https://api.fuseai.com.br` (prod). Referência completa dos endpoints no PRD §7, §9.3 e §10. Este arquivo documenta o que já está implementado.

## Infra

| Método | Rota | Auth | Descrição |
|---|---|---|---|
| GET | `/health` | — | `{ status: "ok", service: "fuseai-api", uptimeSeconds, time }` |

Todas as respostas trazem `x-request-id` (repassa o `X-Request-Id` recebido, se houver).
