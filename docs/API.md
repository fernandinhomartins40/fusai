# API fusai

Base: `http://localhost:4000` (dev) · `https://api.fusai.com.br` (prod). Referência completa dos endpoints no PRD §7, §9.3 e §10. Este arquivo documenta o que já está implementado.

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

## Pagamentos Pix (Fase 6)

| Método | Rota | Auth | Descrição |
|---|---|---|---|
| POST | `/webhooks/asaas` | header `asaas-access-token` | Webhook do Asaas. 200 imediato (repetidos também); 401 com token inválido. Processado pelo worker. |
| GET | `/internal/organizations/:orgId/topup-options` | sessão (membro) | Pacotes globais, mínimo/máximo, taxa, recarga sugerida, `canTopup`, `hasDocument`. |
| POST | `/internal/organizations/:orgId/topups` | sessão (dono/admin/financeiro) | `{ packageId }` ou `{ amountCents }`; header opcional `Idempotency-Key`. 201 com `{ id, status, amountCents, creditMicros, pixCopyPaste, pixQrBase64, expiresAt }`. 502 se o Asaas falhar. |
| GET | `/internal/payments/:id` | sessão (membro) | Status (para o polling). QR e copia e cola só enquanto `PENDING`. |
| GET | `/internal/organizations/:orgId/payments?cursor&limit` | sessão (membro) | Histórico de recargas. |
| GET | `/internal/admin/payments?status&cursor` | super admin | Todos os pagamentos. |
| POST | `/internal/admin/payments/:id/refund` | super admin | Pede o estorno ao Asaas (o débito entra com o webhook `PAYMENT_REFUNDED`). 409 se não for estornável. |

## Usuários finais e checkout (Fase 7)

Credenciais em `/v1`:
- **chave secreta** `fai_live_…` (só no servidor; com `Origin` → 403 `secret_key_in_browser`). Header opcional `X-Fuse-User: <externalId>` cobra/consulta em nome de um usuário final.
- **session token** `fai_st_…` (15 min, escopos `chat`, `checkout`, `balance`). Aceito em `/v1/models`, `/v1/chat/completions`, `/v1/balance`, `/v1/packages`, `/v1/checkout/*`. Com `Origin`, ela precisa estar em `allowedOrigins` do projeto (403 `origin_not_allowed`).

Quem paga o chat: `ORG_WALLET` → organização; `END_USER_WALLET` → usuário final (sem usuário: 400 `app_user_required`); `HYBRID` → usuário final e, sem saldo, a organização.

| Método | Rota | Credencial | Descrição |
|---|---|---|---|
| POST | `/v1/app-users` | secreta (`app_users`) | Upsert `{ externalId, email?, name?, document? }` → `{ id, externalId, email, name, balanceMicros, availableMicros, createdAt }` (201 se novo). Crédito grátis do projeto 1×. |
| GET | `/v1/app-users/:externalId` | secreta (`app_users`) | Dados + saldo. 404 `app_user_not_found`. |
| POST | `/v1/app-users/:externalId/session-token` | secreta (`app_users`) | `{ token, expiresAt, scopes }`. |
| GET | `/v1/packages` | `checkout` | `{ data: [{ id, name, priceCents, creditMicros, bonusMicros, highlight }] }`. |
| POST | `/v1/checkout/pix` | `checkout` | `{ packageId, externalId? (obrigatório com a secreta), returnUrl?, document?, name?, email? }` + `Idempotency-Key` opcional → 201 `{ checkoutId, status, amountCents, creditMicros, packageName, copyPaste, qrBase64, expiresAt, hostedUrl, … }`. Erros: 400 `document_required`, `invalid_return_url`, `billing_mode_org_wallet`; 404 `package_not_found`. |
| GET | `/v1/checkout/:checkoutId` | `checkout` | Status (session token vê só os próprios). |
| GET | `/public/checkout/:checkoutId` | nenhuma | Dados da página hospedada `/pay/{checkoutId}` (30 req/min por IP). |

`GET /v1/balance` com session token ou `X-Fuse-User` devolve a carteira do usuário final (`owner: "app_user"`).

### Webhooks de saída
`POST` JSON para `Project.webhookUrl`: `{ id: "evt_…", type, created, data }`.
Headers: `X-Fuse-Event`, `X-Fuse-Delivery`, `X-Fuse-Signature: t=<unix>,v1=<hex hmac_sha256(secret, t + "." + corpo)>`.
Eventos: `payment.received`, `app_user.credited`, `payment.expired`, `payment.refunded` (`data.payment { id, checkoutId, status, amountCents, creditMicros, packageId }`, `data.appUser { id, externalId, balanceMicros }`), `balance.low` (`availableMicros`, `thresholdMicros`), `usage.limit_reached` (`apiKey`, `spendLimitMicros`, `spentMicros`), `test.ping`.
Sucesso = qualquer 2xx em até 10 s. Novas tentativas: 1 min, 5 min, 30 min, 2 h, 12 h (6 no total). Verificação pronta: `verifyWebhook` de `@fusai/sdk/server`.

### Painel (sessão)
| Método | Rota | Descrição |
|---|---|---|
| GET/POST | `/internal/projects/:id/packages` | Lista / cria pacote (`name, priceCents ≥ 500, creditMicros, bonusMicros, highlight, active, sortOrder`). |
| PATCH/DELETE | `/internal/projects/:id/packages/:packageId` | Edita / remove (desativa se já vendido). |
| GET | `/internal/projects/:id/app-users?q&cursor` | Usuários finais com saldo (50 por página). |
| POST | `/internal/projects/:id/app-users/:appUserId/adjust` | `{ amountMicros (±), description }` — dono/admin. |
| GET | `/internal/projects/:id/webhooks?status&cursor` | Histórico de entregas. |
| POST | `/internal/projects/:id/webhooks/:hookId/resend` | Reenvia agora. |
| POST | `/internal/projects/:id/webhooks/test` | Envia `test.ping` e devolve o resultado. |

## MCP (Fase 8)

`POST /mcp`: Streamable HTTP stateless (JSON-RPC, respostas `application/json`). Header `Authorization: Bearer fai_live_…` de uma chave com escopo `mcp`. `GET`/`DELETE` → 405. Limite: 120 chamadas/min por chave. Erros de autenticação vêm no formato do gateway (401 com `WWW-Authenticate: Bearer`, 403 `insufficient_scope`/`secret_key_required`).

| Tool | Argumentos | Efeito |
|---|---|---|
| `get_integration_guide` | `stack?` (`nextjs`, `react-native`, `flutter`, `node`, `python`, `laravel`) | Markdown personalizado |
| `get_project_config` | — | leitura |
| `list_models` | — | leitura |
| `get_balance` | `externalId?` | leitura |
| `get_usage` | `from?`, `to?` (ISO 8601) | leitura |
| `test_chat` | `model?`, `message?`, `externalId?` | **cobrada** (máx. 64 tokens de saída) |
| `list_packages` | — | leitura |
| `create_package` | `name`, `price_brl`, `credits_brl`, `bonus_brl?`, `highlight?` | cria pacote |
| `update_project_settings` | `allowedOrigins?`, `webhookUrl?` (`""` remove), `billingMode?`, `confirm?` | prévia; aplica com `confirm: true` |
| `create_test_checkout` | `packageId?`, `externalId?` | só chave `fai_test_` + Asaas sandbox |
| `send_test_webhook` | — | envia `test.ping` |

Recursos: `fusai://docs/api`, `fusai://docs/sdk`, `fusai://docs/checkout`, `fusai://project` (FUSAI.md). Prompts: `integrar_chat`, `integrar_compra_pix` (arg `stack?`), `migrar_de_openai`. Toda chamada gera `AuditLog` `mcp.<tool>`.

### Painel
| Método | Rota | Descrição |
|---|---|---|
| GET | `/internal/projects/:id/fusai-md` | `FUSAI.md` (text/markdown, anexo) com os dados atuais do projeto, sem chave. |

### Web (público)
`/docs`, `/docs/<slug>` (HTML), `/docs/<slug>.md` (Markdown), `/llms.txt`, `/llms-full.txt`.

## Webhook da VeloMail (e-mail)
`POST /webhooks/velomail` (público): eventos de entrega da VeloMail (`email.sent`, `email.delivered`, `email.opened`, `email.clicked`, `email.failed`). Exige `X-Webhook-Signature: sha256=<hex hmac_sha256(VELOMAIL_WEBHOOK_SECRET, corpo bruto)>`. Respostas: 200 `{received: true}` (ou `duplicate: true`), 401 assinatura inválida, 400 evento inválido, 503 sem segredo configurado.
