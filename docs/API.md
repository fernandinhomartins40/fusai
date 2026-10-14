# API FuseAI

Base: `http://localhost:4000` (dev) · `https://api.fuseai.com.br` (prod). Referência completa dos endpoints no PRD §7, §9.3 e §10. Este arquivo documenta o que já está implementado.

Erros seguem `{ "error": { "message", "code" } }` (validação: `code: "invalid_request"` + `details`). Todas as respostas trazem `x-request-id` (repassa o `X-Request-Id` recebido, se houver).

## Infra

| Método | Rota | Auth | Descrição |
|---|---|---|---|
| GET | `/health` | — | `{ status: "ok", service: "fuseai-api", uptimeSeconds, time }` |

## Autenticação (Better Auth)

Montado em `/api/auth/*`. Principais rotas usadas pelo web: `POST /sign-up/email`, `POST /sign-in/email`, `POST /sign-out`, `GET /get-session`, `GET /verify-email`, `POST /send-verification-email`, `POST /request-password-reset`, `POST /reset-password`. Login exige email verificado (403 `EMAIL_NOT_VERIFIED`).

## Painel (sessão por cookie)

Requisições não-GET precisam vir do `APP_URL` (`Origin`), senão 403.

| Método | Rota | Descrição |
|---|---|---|
| GET | `/internal/me` | Usuário (`role`) + organizações com papel, saldo (`balanceMicros`, `reservedMicros` como string) e projetos. |
| POST | `/internal/onboarding/organization` | `{ name, document (CPF/CNPJ), phone }` → cria org, carteira e membership OWNER. 201 `{ id, name, slug }`. |
| GET | `/internal/organizations/:orgId/wallet` | `{ id, balanceMicros, reservedMicros, availableMicros, billingType, creditLimitMicros }` (membros; 404 para não membros). |
| GET | `/internal/organizations/:orgId/wallet/ledger?cursor&limit` | Extrato, mais recente primeiro: `{ items[{ id, type, amountMicros, balanceAfter, referenceType, referenceId, description, createdAt }], nextCursor }`. |
| POST | `/internal/organizations/:orgId/projects` | `{ name, billingMode? }` → 201 `{ id, name, slug, billingMode }`. Exige papel OWNER/ADMIN/DEVELOPER (404 se não for membro). |

## Admin (só `SUPER_ADMIN`)

| Método | Rota | Descrição |
|---|---|---|
| GET | `/internal/admin/overview` | `{ users, organizations, providers, activeModels }`. 401 sem sessão, 403 sem papel. |
| GET | `/internal/admin/providers` | Lista provedores: `{ id, slug, name, baseUrl, status, priority, timeoutMs, hasKey, keyMask, keyError, modelCount }`. A chave nunca é retornada. |
| GET | `/internal/admin/providers/:id` | Detalhe (mesmo formato). |
| POST | `/internal/admin/providers` | `{ slug, name, baseUrl, apiKey?, status?, priority?, timeoutMs? }`. 400 ao ativar sem chave; 409 se o slug existe. |
| PATCH | `/internal/admin/providers/:id` | Campos parciais; `apiKey` substitui a chave (omitido = mantém). |
| DELETE | `/internal/admin/providers/:id` | 204; 409 se houver modelos. |
| POST | `/internal/admin/providers/:id/test` | `{ ok, status, latencyMs, models[], error }` via `GET {baseUrl}/models`. |
| GET | `/internal/admin/models` | Modelos com `pricing: { markup, inputPerM, cachedInputPerM, outputPerM, inputCostBrlPerM, outputCostBrlPerM, inputMarginBps, outputMarginBps }` (micros em string). |
| GET | `/internal/admin/models/:id` | Detalhe. |
| POST | `/internal/admin/models` | Custos em US$/1M como string decimal; preço fixo em micros (string). Novo modelo entra inativo. |
| PATCH | `/internal/admin/models/:id` | Campos parciais (omitidos não mudam). |
| DELETE | `/internal/admin/models/:id` | 204; 409 se já houver consumo. |
| GET | `/internal/admin/settings` | `{ usd_brl_rate, default_markup, topup_fee_pct, min_topup_cents, low_balance_threshold_micros, welcome_bonus_micros }`. |
| PUT | `/internal/admin/settings` | Substitui todos; aceita vírgula decimal. Invalida o cache de preços. |
| GET | `/internal/admin/organizations?q&cursor&limit` | Clientes (busca por nome, slug, CPF/CNPJ, email de membro) com saldo. |
| GET | `/internal/admin/organizations/:id` | Detalhe: membros, projetos e carteira (`activeHolds`, `ledgerSumMicros`, `consistent`). |
| GET | `/internal/admin/organizations/:id/ledger` | Extrato (mesmo formato do cliente). |
| POST | `/internal/admin/organizations/:id/wallet/adjust` | `{ amountMicros (string com sinal), reason }` → 201 com o lançamento `ADJUSTMENT`. |

Todas as alterações do admin geram `AuditLog`.
