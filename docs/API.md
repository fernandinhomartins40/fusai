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

## Painel — projetos e chaves

| Método | Rota | Descrição |
|---|---|---|
| GET | `/internal/projects/:projectId` | Dados do projeto (para membros). |
| GET | `/internal/projects/:projectId/api-keys` | Chaves do projeto: prefixo, ambiente, escopos, limites, último uso, status. Nunca a chave nem o hash. |
| POST | `/internal/projects/:projectId/api-keys` | `{ name, env?, scopes?, rpmLimit?, spendLimitMicros?, expiresAt? }` → 201 com `key` (única vez). OWNER/ADMIN/DEVELOPER. |
| PATCH | `/internal/api-keys/:id` | `{ name?, scopes?, rpmLimit?, spendLimitMicros? }`. |
| POST | `/internal/api-keys/:id/revoke` | Revoga (vale na hora no gateway). |

## Gateway público (`Authorization: Bearer fai_live_...`)

Erros: `{ "error": { "message", "type", "code" } }`. Códigos:
- 400 `invalid_request`
- 401 `invalid_api_key`
- 402 `insufficient_funds`, `spend_limit_reached`
- 403 `model_not_allowed`, `insufficient_scope`, `account_suspended`
- 404 `model_not_found`
- 429 `rate_limited` (com `retry-after`)
- 502 `upstream_error`
- 503 `model_unavailable`

As respostas trazem `x-fuse-request-id` e, no chat, `x-ratelimit-limit`/`x-ratelimit-remaining`.

| Método | Rota | Escopo | Descrição |
|---|---|---|---|
| GET | `/v1/models` | chat | Lista no formato OpenAI + `context_window`, `max_output_tokens`, `capabilities`, `pricing { currency: "BRL", unit: "1M tokens", input, cached_input, output }`. |
| POST | `/v1/chat/completions` | chat | Compatível com OpenAI (messages, tools, stream, stream_options, temperature, max_tokens, response_format…). `n` só 1. |
| GET | `/v1/balance` | billing:read | `{ balance, reserved, available, *_micros, billing_type }`. |
| GET | `/v1/usage?from&to` | billing:read | Consumo do projeto por modelo (padrão: últimos 30 dias; máximo de 366). |

## Painel — análises, projetos, equipe e organização (Fase 5)

Membros da organização; 404 para quem não é membro.

| Método | Rota | Descrição |
|---|---|---|
| GET | `/internal/organizations/:orgId/overview` | Carteira, alerta de saldo baixo, gasto e requisições hoje/7d/30d, série diária (30 dias, fuso de São Paulo) e gasto por modelo. |
| GET | `/internal/organizations/:orgId/usage?from&to&projectId&modelId` | Totais, série diária, por modelo e por projeto (padrão 30 dias; máximo de 366). |
| GET | `/internal/organizations/:orgId/usage.csv?…` | CSV dia × projeto × modelo. |
| GET | `/internal/organizations/:orgId/logs?projectId&modelId&status&from&to&cursor&limit` | Últimas requisições (sem conteúdo), paginadas por cursor. |
| GET | `/internal/organizations/:orgId/wallet/ledger.csv` | Extrato completo em CSV. |
| GET | `/internal/organizations/:orgId/models` | Modelos servíveis com o preço da organização. |
| GET | `/internal/organizations/:orgId` | Configurações da organização + papel do usuário. |
| PATCH | `/internal/organizations/:orgId` | `{ name?, document?, phone?, lowBalanceAlertMicros?, suggestedTopupCents? }` (dono/admin). |
| PATCH | `/internal/projects/:projectId` | `{ name?, billingMode?, allowedOrigins?, allowedModelIds?, defaultModelId?, webhookUrl?, freeCreditMicros? }`. |
| GET | `/internal/projects/:projectId/webhook-secret` | Revela o segredo (decifra). |
| POST | `/internal/projects/:projectId/webhook-secret/rotate` | Gera um novo `whsec_…`. |
| GET | `/internal/organizations/:orgId/members` | Membros, convites pendentes e `myRole`. |
| POST | `/internal/organizations/:orgId/invitations` | `{ email, role }` → envia o email (dono/admin). |
| DELETE | `/internal/invitations/:id` | Cancela um convite. |
| PATCH | `/internal/organizations/:orgId/members/:userId` | `{ role }`. |
| DELETE | `/internal/organizations/:orgId/members/:userId` | Remove (ou sai, se for o próprio usuário). |
| GET | `/internal/invitations/:token` | Dados do convite para a pessoa logada. |
| POST | `/internal/invitations/:token/accept` | Aceita (o email da conta precisa ser o do convite). |
