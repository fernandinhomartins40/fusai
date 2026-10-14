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
| POST | `/internal/organizations/:orgId/projects` | `{ name, billingMode? }` → 201 `{ id, name, slug, billingMode }`. Exige papel OWNER/ADMIN/DEVELOPER (404 se não for membro). |

## Admin (só `SUPER_ADMIN`)

| Método | Rota | Descrição |
|---|---|---|
| GET | `/internal/admin/overview` | `{ users, organizations, providers, activeModels }`. 401 sem sessão, 403 sem papel. |
