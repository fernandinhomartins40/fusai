# Inventário da aplicação (PIE §2.2)

- **Data:** 2026-10-22 · **Base:** commit `43dd2c3` + mudanças locais não commitadas da auditoria PIE (correções em andamento por outros agentes)
- **Ambiente:** dev local Windows 11. Postgres embarcado na porta 5433 (banco de teste exclusivo `fuseai_pie_inv`), Redis local na 6379. Não houve acesso de escrita à VPS nem a serviços reais (Asaas, VeloMail, provedores de IA).
- **Método:** leitura do código (rotas extraídas por script de `apps/api/src/**`), mapa de jornadas de [OPORTUNIDADES_PRODUTO.md](OPORTUNIDADES_PRODUTO.md) §1 e [_parciais/dados_apis_integracoes.md](_parciais/dados_apis_integracoes.md), além da suíte executada nesta data. O estado de cada linha e a prova correspondente estão em [MATRIZ_VERIFICACAO.md](MATRIZ_VERIFICACAO.md).

## 1. Arquitetura

| Camada | Tecnologia | Onde |
|---|---|---|
| Monorepo | pnpm workspaces + Turborepo, Biome, TypeScript | `package.json`, `turbo.json`, `biome.json` |
| Web | Next.js 15 (App Router), Tailwind v4, `@fusai/ui` | `apps/web` (grupos `(marketing)`, `(auth)`, `(dashboard)/app`, `(admin)/admin`, `pay/[checkoutId]`, `docs`) |
| API | Fastify 5 | `apps/api/src/app.ts` (registro dos módulos), `server.ts` |
| Worker | BullMQ (Redis) | `apps/api/src/worker.ts` (jobs `process-webhook`, `deliver-webhooks`, `expire-payments`, `sweep-webhooks`, `release-holds`) |
| Banco | PostgreSQL 16 + Prisma 6 | `packages/db/prisma/schema.prisma`, 11 migrations (a 11ª, `20261022120000_hold_api_key`, foi criada nesta auditoria e ainda não foi commitada) |
| Cache/fila/limites | Redis 7 (rate limit, circuit breaker, filas) | `apps/api/src/lib/redis.ts`, `lib/rate-limit.ts`, `modules/gateway/circuit-breaker.ts` |
| Autenticação | Better Auth (email+senha, verificação, reset, plugin admin com ban e personificação) | `apps/api/src/modules/auth/auth.ts`, rota `/api/auth/*` em `auth/routes.ts:7-9` |
| Pagamentos | Asaas Pix (cliente, cobrança, QR, webhook, estorno) | `apps/api/src/payments/asaas.ts`, `modules/payments/*` |
| Email | VeloMail (envio + webhook de eventos); Mailpit em dev | `lib/mailer.ts`, `lib/email-templates.ts`, `modules/email-webhooks/routes.ts` |
| Provedores de IA | Cliente OpenAI-compatível com fallback e circuit breaker | `apps/api/src/providers/openai-compatible.ts`, `modules/gateway/chat.ts` |
| MCP | `@modelcontextprotocol/sdk` (Streamable HTTP) | `modules/mcp/server.ts` (chave de projeto), `modules/mcp/agent-server.ts` (chave de organização) |
| Pacotes publicáveis | `@fusai/sdk`, `@fusai/react` | `packages/sdk/src`, `packages/react/src` |
| Docs | Markdown → `content.generated.ts`, `llms.txt`, FUSAI.md | `packages/docs/content/01..12-*.md`, `apps/web/app/docs`, `app/llms.txt`, `app/llms-full.txt`, `app/docs-md/[slug]` |
| Exemplo | Next PWA (porta 3001) | `examples/next-pwa` (session token, `/creditos`, proxy `/api/fusai/[...path]`, webhook `/api/webhooks/fuse`) |
| Deploy | GitHub Actions → rsync → `deploy.sh` na VPS (Docker Compose + nginx) | `.github/workflows/deploy.yml`, `deploy/deploy.sh`, `deploy/docker-compose.vps.yml`, `deploy/nginx*` |

**Papéis:** `SUPER_ADMIN` (plataforma); membros da organização `OWNER`, `ADMIN`, `DEVELOPER`, `BILLING`; usuário final do app do cliente (identificado por `externalId` e session token).
**Credenciais de máquina:** chave secreta de projeto (`fai_live_`/`fai_test_`, com escopos e limites), chave de agente da organização (MCP), session token JWT de usuário final.
**Tenant:** `Organization` → `Project` → `ApiKey`/`AppUser`; carteiras (`Wallet`) da organização ou do usuário final.

## 2. Tabela de rastreabilidade

Legenda das colunas: **UI/entrada** = tela ou cliente; **API/serviço** = rota e arquivo:linha; **Persistência/integração** = tabelas e serviços externos; **Permissão/plano** = quem pode; **Evidência** = teste que cobre (ver a matriz). O estado é o da matriz em 2026-10-22.

### 2.1 Identidade e acesso

| ID | Domínio/módulo | Função/jornada | UI/entrada | API/serviço | Persistência/integração | Permissão/plano | Evidência | Estado |
|---|---|---|---|---|---|---|---|---|
| A-01 | auth | Cadastro, verificação de email, login | `(auth)/cadastro`, `verificar-email`, `entrar` | `/api/auth/*` (`auth/routes.ts:7`, `auth/auth.ts`) | `User`, `Session`, `Account`, `Verification`; VeloMail | público | `auth.test.ts:26` | VERIFICADA (API) |
| A-02 | auth | Cliente não define o próprio papel | cadastro | `auth/auth.ts` | `User.role` | público | `auth.test.ts:57` | VERIFICADA |
| A-03 | auth | Recuperar e redefinir senha | `recuperar-senha`, `redefinir-senha` | `/api/auth/*` | `Verification`; email | público | `auth.test.ts:73`, `:162` | VERIFICADA (API) |
| A-04 | auth | Links de email sempre voltam ao site | emails | `auth/auth.ts` | — | público | `auth.test.ts:109` | VERIFICADA |
| A-05 | auth | Sessão só do navegador sem "lembrar" | `entrar` | `auth/auth.ts` | `Session` | autenticado | `auth.test.ts:183` | VERIFICADA |
| A-06 | auth | Trava de senha errada por conta (S-05) | `entrar` | `auth/auth.ts` (em alteração) | Redis | público | `auth.test.ts:272` | FALHA REPRODUZIDA (correção em andamento) |
| A-07 | web | Portão de sessão em `/app` e `/admin` | middleware | `apps/web/middleware.ts` | cookie Better Auth | autenticado | inspeção | IMPLEMENTADA, NÃO VERIFICADA |
| A-08 | admin | Rotas admin só para SUPER_ADMIN | `/admin/*` | `/internal/admin/*` | — | SUPER_ADMIN | `auth.test.ts:206`, `admin-panel.test.ts:109`, `admin.test.ts:201` | VERIFICADA |
| A-09 | admin | Banir, desbanir, revogar sessões | `/admin/usuarios` | `admin/users.ts:18,66,90,102` | `User.banned`, `Session` | SUPER_ADMIN | `admin-panel.test.ts:228` | VERIFICADA |
| A-10 | admin | Personificar cliente com trilha de auditoria | `/admin/clientes/[id]`, `impersonation-banner.tsx` | Better Auth `admin/impersonate-user` (hook em `auth/auth.ts:83-110`) | `Session.impersonatedBy`, `AuditLog` | SUPER_ADMIN | `admin-panel.test.ts:254` | VERIFICADA |
| A-11 | equipe | Convidar por email, aceitar, expiração | `/app/equipe`, `(auth)/convite/[token]` | `dashboard/team.ts:92,137,223,236` | `Invitation`, `Member`; email | OWNER/ADMIN | `dashboard-p5.test.ts:294`, `:330` | VERIFICADA |
| A-12 | equipe | Papéis e regra do último dono | `/app/equipe` | `dashboard/team.ts:46,154,176` | `Member` | OWNER/ADMIN | `dashboard-p5.test.ts:340` | VERIFICADA |

### 2.2 Organização, projetos e chaves

| ID | Domínio/módulo | Função/jornada | UI/entrada | API/serviço | Persistência/integração | Permissão/plano | Evidência | Estado |
|---|---|---|---|---|---|---|---|---|
| O-01 | onboarding | Criar organização (CPF/CNPJ validado) com carteira | `/app/onboarding` (`organization-step.tsx`) | `POST /internal/onboarding/organization` (`dashboard/routes.ts:82`) | `Organization`, `Wallet`, `Member` | autenticado | `routes.test.ts:34`, `:73` | VERIFICADA (API) |
| O-02 | projetos | Criar projeto e escolher modo de cobrança | onboarding, `/app/projetos` | `POST /internal/organizations/:orgId/projects` (`routes.ts:92`) | `Project` | OWNER/ADMIN/DEV | `routes.test.ts:34` | VERIFICADA (API) |
| O-03 | dashboard | Bloqueio de mutação cross-origin e de outra org; sessão obrigatória | todas | plugin de sessão (`lib/session.ts`) | — | membro | `routes.test.ts:83`, `:96` | VERIFICADA |
| O-04 | organização | Configurações da org (troca de documento descarta cliente Asaas) | `/app/configuracoes` (`org-settings-form.tsx`) | `GET/PATCH /internal/organizations/:orgId` (`projects.ts:196,217`) | `Organization` | OWNER/ADMIN | `dashboard-p5.test.ts:260` | VERIFICADA |
| O-05 | projetos | Configurações do projeto: modelos permitidos, origens, webhook | `/app/projetos/[id]/configuracoes`, `/modelos` | `PATCH /internal/projects/:projectId` (`projects.ts:98`), `GET .../models` (`:68`) | `Project` | editores | `dashboard-p5.test.ts:204` | VERIFICADA |
| O-06 | projetos | Segredo de webhook cifrado: revelar e rotacionar | `/app/webhooks`, `webhook-secret.tsx` | `projects.ts:153,163` | `Project.webhookSecretEnc` (AES-GCM) | OWNER/ADMIN/DEV | `dashboard-p5.test.ts:247` | VERIFICADA |
| O-07 | projetos | FUSAI.md personalizado | `/app/projetos/[id]/integracao` | `GET /internal/projects/:projectId/fusai-md` (`projects.ts:179`) | `packages/docs` | membro | `end-users.test.ts:531`, `docs.test.ts:101` | VERIFICADA |
| K-01 | chaves | Criar chave, mostrar só uma vez, guardar hash com pepper | `/app/projetos/[id]/chaves`, `key-reveal.tsx`, onboarding passo 3 | `POST /internal/projects/:projectId/api-keys` (`api-keys.ts:75`); `api-keys/keys.ts` | `ApiKey.keyHash` | OWNER/ADMIN/DEV | `api-keys.test.ts:34`, `keys.test.ts:5,15,20` | VERIFICADA |
| K-02 | chaves | Chaves de teste, editar limites, revogar | painel de chaves | `api-keys.ts:62,106,126` | `ApiKey` | OWNER/ADMIN/DEV | `api-keys.test.ts:63` | VERIFICADA (API); edição sem UI (P-16) |
| K-03 | chaves | Isolamento de chaves entre organizações | — | `api-keys.ts` | — | membro | `api-keys.test.ts:87` | VERIFICADA |
| K-04 | chaves | Chave criada no painel funciona no gateway | — | `gateway/auth.ts` | `ApiKey` | — | `api-keys.test.ts:107` | VERIFICADA |
| K-05 | agente | Chaves de agente da organização (criar, listar, revogar) | `/app/agente` | `dashboard/agent-keys.ts:35,48,83` | `ApiKey` (org) | OWNER/ADMIN | `agent.test.ts:65` | VERIFICADA |

### 2.3 Gateway de IA (`/v1`, prefixo em `app.ts:175`)

| ID | Domínio/módulo | Função/jornada | UI/entrada | API/serviço | Persistência/integração | Permissão/plano | Evidência | Estado |
|---|---|---|---|---|---|---|---|---|
| G-01 | gateway | Chat sem stream com débito exato | SDK OpenAI, `@fusai/sdk` | `POST /v1/chat/completions` (`gateway/routes.ts:95`, `chat.ts`) | `UsageLog`, `WalletHold`, `LedgerEntry`; provedor | chave `chat` | `gateway.test.ts:48` | VERIFICADA |
| G-02 | gateway | Stream SSE com cobrança pelo usage final | idem | `chat.ts`, `providers/sse.ts` | idem | chave `chat` | `gateway.test.ts:86`, `:117`, `sse.test.ts` | VERIFICADA |
| G-03 | gateway | 402 sem saldo | idem | `chat.ts`, `billing/wallet.ts` | `Wallet` | — | `gateway.test.ts:131` | VERIFICADA |
| G-04 | gateway | 401 para chave revogada, expirada ou malformada | idem | `gateway/auth.ts` | `ApiKey` | — | `gateway.test.ts:146` | VERIFICADA |
| G-05 | gateway | Fallback de provedor e circuit breaker | — | `chat.ts` (`withFallback`), `circuit-breaker.ts` | Redis | — | `gateway.test.ts:164`, `:177`, `:187` | VERIFICADA |
| G-06 | gateway | Estimativa de uso sem `usage` do provedor | — | `gateway/usage.ts` | `UsageLog` | — | `gateway.test.ts:203`, `usage.test.ts:51` | VERIFICADA (sem tool_calls/reasoning: D-14) |
| G-07 | gateway | Desconexão do cliente aborta e cobra o gerado | — | `chat.ts` | `UsageLog` | — | `gateway.test.ts:213` | VERIFICADA |
| G-08 | gateway | RPM por chave | — | `lib/rate-limit.ts` | Redis | por chave | `gateway.test.ts:242` | VERIFICADA |
| G-09 | gateway | Org INTERNAL não debita, registra custo virtual | — | `gateway/billing.ts` | `UsageLog` | org INTERNAL | `gateway.test.ts:254` | VERIFICADA |
| G-10 | gateway | `/v1/models` com preço em BRL e allow-list | — | `routes.ts:88`, `catalog.ts` | `Model` | chave | `gateway.test.ts:265`, `:289` | VERIFICADA |
| G-11 | gateway | Limite de gasto mensal por chave (chave secreta) | — | `gateway/billing.ts`, `chat.ts` | `UsageLog`, `WalletHold.apiKeyId` | limite da chave | `gateway.test.ts:300`; concorrência `pie-receita.test.ts:97` (R-05) | VERIFICADA |
| G-12 | gateway | Limite mensal também para session token (R-04) | app do cliente | `chat.ts` | idem | limite do projeto/chave | `pie-receita.test.ts:89` | FALHA REPRODUZIDA (correção em andamento) |
| G-13 | gateway | `/v1/balance` e `/v1/usage` com escopos | SDK | `routes.ts:118,141` | `Wallet`, `UsageLog` | escopos | `gateway.test.ts:309` | VERIFICADA |
| G-14 | gateway | Validação do corpo no formato de erro OpenAI | — | `gateway/errors.ts` | — | — | `gateway.test.ts:337` | VERIFICADA |
| G-15 | gateway | `fuse/auto`: modelo mais barato, com fallback | — | `gateway/auto-model.ts` | `Model` | — | `auto-model.test.ts:33,47,79` | VERIFICADA |
| G-16 | gateway | Teto de saída enviado ao provedor igual ao da reserva (R-02) | — | `chat.ts` | provedor | — | `pie-receita.test.ts:39,49,57` | VERIFICADA |
| G-17 | gateway | Preço: cache, arredondamento para cima, custo em BRL | — | `gateway/usage.ts`, `packages/shared/src/pricing.ts`, `money.ts` | — | — | `usage.test.ts`, `pricing.test.ts`, `money.test.ts` | VERIFICADA |
| G-18 | gateway | CORS de `/v1` sem credenciais (painel não reflete origem) | navegador | `app.ts:125` | — | — | `end-users.test.ts:456` | VERIFICADA |
| G-19 | gateway | Timeout do stream separado de inatividade (D-02) | — | `providers/openai-compatible.ts:53-64` | — | — | nenhum | IMPLEMENTADA, NÃO VERIFICADA (suspeita de corte em 120 s) |
| G-20 | segurança | Bloqueio de SSRF para webhooks e provedores | — | `lib/ssrf.ts` | — | — | `ssrf.pie.test.ts` (15) | VERIFICADA |

### 2.4 Saldo e cobrança

| ID | Domínio/módulo | Função/jornada | UI/entrada | API/serviço | Persistência/integração | Permissão/plano | Evidência | Estado |
|---|---|---|---|---|---|---|---|---|
| B-01 | billing | Reserva atômica sem estourar carteira pré-paga | gateway | `billing/wallet.ts` (`reserve`) | `Wallet`, `WalletHold` | — | `wallet.test.ts:40` | VERIFICADA |
| B-02 | billing | Ledger = saldo com reserva e liquidação concorrentes | — | `wallet.ts` (`settle`) | `LedgerEntry` | — | `wallet.test.ts:60`, `:139` | VERIFICADA |
| B-03 | billing | Pós-pago até o limite de crédito; bloqueio com saldo negativo | — | `wallet.ts` | `Wallet.creditLimitMicros` | admin define | `wallet.test.ts:113`, `:133` | VERIFICADA |
| B-04 | billing | Liberar holds expiradas e cobrar liquidação tardia uma vez | worker `release-holds` | `wallet.ts` (`releaseExpiredHolds`) | `WalletHold` | — | `wallet.test.ts:158` | VERIFICADA (função) |
| B-05 | billing | Pré-pago nunca fica negativo (cobrança, ajuste, estorno) | gateway, admin | `wallet.ts`, `payments/service.ts` | `LedgerEntry` | — | `never-negative.test.ts:39,60,77` | VERIFICADA |
| B-06 | carteira | Saldo, extrato paginado, privado a membros | `/app/carteira`, `ledger-table.tsx` | `dashboard/wallet.ts:27,40` | `Wallet`, `LedgerEntry` | membro | `organizations.test.ts:104`, `:143` | VERIFICADA |
| B-07 | carteira | Exportar extrato e uso em CSV com neutralização de fórmulas | `export-csv-button.tsx` | `analytics.ts:222,332`, `lib/csv.ts` | — | membro | `dashboard-p5.test.ts:132`, `:172`, `csv.test.ts` | VERIFICADA |
| B-08 | admin | Ajuste manual de saldo com auditoria | `/admin/clientes/[id]` (`wallet-adjust-form.tsx`) | `POST /internal/admin/organizations/:id/wallet/adjust` (`organizations.ts:149`) | `LedgerEntry`, `AuditLog` | SUPER_ADMIN | `organizations.test.ts:31`, `:86` | VERIFICADA |

### 2.5 Pagamentos Pix (Asaas)

| ID | Domínio/módulo | Função/jornada | UI/entrada | API/serviço | Persistência/integração | Permissão/plano | Evidência | Estado |
|---|---|---|---|---|---|---|---|---|
| P-01 | payments | Recarga da org: cliente Asaas, cobrança, QR | `/app/carteira?recarga=1`, `topup-dialog.tsx` | `GET .../topup-options`, `POST .../topups` (`payments/routes.ts:79,112`) | `Payment`; Asaas | OWNER/ADMIN/BILLING | `payments.test.ts:94` (Asaas falso) | VERIFICADA (fake); real BLOQUEADA |
| P-02 | payments | Webhook Asaas autenticado, idempotente, confirmado no PSP | Asaas | `POST /webhooks/asaas` (`routes.ts:22`), `service.ts` | `InboundWebhookEvent`, `LedgerEntry` | token | `payments.test.ts:118,156,173,184` | VERIFICADA |
| P-03 | payments | Sweep de eventos deixados pela fila | worker `sweep-webhooks` | `service.ts` | `InboundWebhookEvent` | — | `payments.test.ts:208` | VERIFICADA (função) |
| P-04 | payments | Expirar cobranças, cancelar no Asaas, crédito tardio | worker `expire-payments` | `service.ts` | `Payment` | — | `payments.test.ts:222` | VERIFICADA (função) |
| P-05 | payments | Estorno pelo admin; o webhook debita uma vez | `/admin/pagamentos` (`refund-button.tsx`) | `POST /internal/admin/payments/:id/refund` (`routes.ts:235`) | `Payment`, `LedgerEntry` | SUPER_ADMIN | `payments.test.ts:258`, `never-negative.test.ts:77` | VERIFICADA |
| P-06 | payments | Mínimo Pix R$ 5, taxa, Idempotency-Key, falha do PSP | diálogo de recarga | `service.ts` | `Payment` | — | `payments.test.ts:289,305,350` | VERIFICADA |
| P-07 | payments | Permissões e histórico privado | `/app/carteira` (`payments-table.tsx`) | `GET .../payments` (`routes.ts:167`), `GET /internal/payments/:id` (`:156`) | `Payment` | OWNER/ADMIN/BILLING | `payments.test.ts:357` | VERIFICADA |
| P-08 | payments | Recarga da org via API `/v1/topups` | SDK `account` | `gateway/topups.ts:52,79,109,125` | `Payment` | escopo `checkout` | `topups.test.ts:52,116,143`, `account.test.ts` | VERIFICADA |
| P-09 | payments | Estorno parcial, chargeback, MED | Asaas | `payments/asaas.ts:23-25,185-191` (eventos ignorados) | — | — | inspeção (D-09) | PARCIAL |
| P-10 | payments | Email de pagamento confirmado | email | `payments/notify.ts`, `email-templates.ts:61` | VeloMail | — | nenhum teste do envio | IMPLEMENTADA, NÃO VERIFICADA |
| P-11 | payments | Retomar Pix pendente pela UI | `payments-table.tsx` | `GET /internal/payments/:id` | — | — | inspeção (P-12 de produto) | PARCIAL |

### 2.6 Usuários finais, checkout e webhooks de saída

| ID | Domínio/módulo | Função/jornada | UI/entrada | API/serviço | Persistência/integração | Permissão/plano | Evidência | Estado |
|---|---|---|---|---|---|---|---|---|
| E-01 | app-users | Upsert de usuário final com crédito grátis uma única vez | backend do cliente | `POST /v1/app-users`, `GET /v1/app-users/:externalId` (`gateway/end-users.ts:82,91`), `app-users/service.ts` | `AppUser`, `Wallet` | chave `app_users` | `end-users.test.ts:128`, `:148` | VERIFICADA |
| E-02 | app-users | Session token: escopo, origem, débito do usuário final | `examples/next-pwa/app/api/session` | `POST /v1/app-users/:externalId/session-token` (`end-users.ts:100`), `lib/jwt.ts` | JWT | chave `app_users` | `end-users.test.ts:153` | FALHA REPRODUZIDA (regressão em arquivo em edição paralela; passou na 1ª execução) |
| E-03 | app-users | Tokens adulterados, expirados ou de outro projeto | — | `gateway/auth.ts` | — | — | `end-users.test.ts:190`, `jwt.test.ts` | VERIFICADA |
| E-04 | app-users | Chave secreta usada no navegador é recusada | — | `gateway/auth.ts` | — | — | `end-users.test.ts:204` | VERIFICADA |
| E-05 | app-users | Modos END_USER_WALLET, HYBRID e header `X-Fuse-User` | — | `gateway/billing.ts` | `Wallet` | modo do projeto | `end-users.test.ts:211`, `:228` | VERIFICADA |
| E-06 | checkout | Pacotes e checkout Pix do usuário final | `<FusaiCheckout/>`, `/pay/[checkoutId]` | `GET /v1/packages`, `POST /v1/checkout/pix`, `GET /v1/checkout/:id` (`end-users.ts:125,145,191`), `GET /public/checkout/:publicId` (`payments/routes.ts:284`) | `Payment`, `CreditPackage`; Asaas | chave `checkout` ou session token | `end-users.test.ts:245`, `:413` | VERIFICADA (API) |
| E-07 | webhooks-out | Webhooks assinados (HMAC) com retentativas | backend do cliente | `webhooks-out/service.ts` (worker `deliver-webhooks`) | `OutboundWebhook` | — | `end-users.test.ts:349` | VERIFICADA |
| E-08 | webhooks-out | Testar e reenviar webhook pelo painel | `/app/webhooks`, `webhook-deliveries.tsx` | `end-users.ts:225,258,278` | `OutboundWebhook` | OWNER/ADMIN/DEV | `end-users.test.ts:363`, `:401` | VERIFICADA |
| E-09 | pacotes | CRUD de pacotes do projeto, lista de usuários, ajuste manual | `/app/projetos/[id]/pacotes`, `/usuarios` | `end-users.ts:60,73,95,121,147,181` | `CreditPackage`, `AppUser`, `LedgerEntry` | editores | `end-users.test.ts:478` | VERIFICADA |
| E-10 | receita | Créditos de usuário final sem lastro (R-01: pacote, crédito grátis, bônus) | painel e MCP | `dashboard/end-users.ts`, `mcp/agent-server.ts`, `app-users/service.ts` | `LedgerEntry` | OWNER/ADMIN | `pie-receita.test.ts:65`, `:76` | FALHA REPRODUZIDA (aguarda decisão do dono) |

### 2.7 MCP

| ID | Domínio/módulo | Função/jornada | UI/entrada | API/serviço | Persistência/integração | Permissão/plano | Evidência | Estado |
|---|---|---|---|---|---|---|---|---|
| M-01 | mcp | Ferramentas, recursos e prompts do PRD §10.1 (chave de projeto) | Claude Code/Cursor etc. (`mcp-commands.tsx`) | `POST/GET/DELETE /mcp` (`mcp/routes.ts:96,173,174`); `server.ts`: `get_integration_guide`, `get_project_config`, `list_models`, `get_balance`, `get_usage`, `test_chat`, `list_packages`, `create_package`, `update_project_settings`, `create_test_checkout`, `send_test_webhook`; prompts `integrar_chat`, `integrar_compra_pix`, `migrar_de_openai` | — | escopo `mcp` | `mcp.test.ts:79` | VERIFICADA |
| M-02 | mcp | Autenticação (sem chave, session token, sem escopo) | — | `mcp/routes.ts` | — | escopo `mcp` | `mcp.test.ts:116` | VERIFICADA |
| M-03 | mcp | Guia personalizado por projeto e stack | — | `server.ts`, `integration/snapshot.ts` | `packages/docs` | — | `mcp.test.ts:157` | VERIFICADA |
| M-04 | mcp | `test_chat` passa pelo gateway real e é cobrado | — | `mcp/actions.ts` | `UsageLog` | — | `mcp.test.ts:189` | VERIFICADA |
| M-05 | mcp | `update_project_settings` com prévia e `confirm` | — | `server.ts` | `Project` | — | `mcp.test.ts:205` | VERIFICADA |
| M-06 | mcp | `create_package`, `create_test_checkout` só em sandbox | — | `server.ts` | `CreditPackage`, `Payment` | chave de teste | `mcp.test.ts:243` | VERIFICADA |
| M-07 | mcp | Chave MCP respeita o papel de quem a criou (S-01) | — | `server.ts` (alterado) | `Project` | papel do criador | `pie-security.test.ts:48,62,76,89,108` | VERIFICADA (5 testes OK; erro de teardown do Redis na suíte) |
| M-08 | mcp-agente | Agente da org configura revenda de ponta a ponta | `/app/agente` | `agent-server.ts`: `get_account`, `get_setup_guide`, `search_docs`, `read_doc`, `list_projects`, `create_project`, `create_api_key`, `revoke_api_key`, `create_package`, `update_package`, `update_project_settings`, `list_*`, prompts `configurar_uso_proprio`, `configurar_revenda` | várias | chave de agente | `agent.test.ts:95` | VERIFICADA |
| M-09 | mcp-agente | Uso próprio: Pix da org e ajuste de crédito de usuário final | — | `agent-server.ts` (`create_topup_pix`, `adjust_end_user_credits`) | `Payment`, `LedgerEntry` | chave de agente | `agent.test.ts:196` | VERIFICADA |
| M-10 | mcp-agente | Nunca alcança outra org; para quando o criador perde o papel | — | `agent-server.ts` | — | — | `agent.test.ts:237` | VERIFICADA |
| M-11 | mcp-agente | Texto de usuário final marcado como dado não confiável (S-03) | — | `agent-server.ts`, `app-users/service.ts:41` (em alteração) | `AppUser` | — | `agent.test.ts:276` | BLOQUEADA (ambiente: banco de teste local em WIN1252 rejeita o caractere U+202E do teste) |

### 2.8 Painel do cliente (análises)

| ID | Domínio/módulo | Função/jornada | UI/entrada | API/serviço | Persistência/integração | Permissão/plano | Evidência | Estado |
|---|---|---|---|---|---|---|---|---|
| AN-01 | analytics | Visão geral, consumo por dia de São Paulo | `/app` (Início), `/app/consumo` | `analytics.ts:130,199` | `UsageLog` | membro | `dashboard-p5.test.ts:91`, `:114` | VERIFICADA |
| AN-02 | analytics | Filtros, logs paginados | `/app/logs` (`logs-table.tsx`) | `analytics.ts:265` | `UsageLog` | membro | `dashboard-p5.test.ts:132` | VERIFICADA |
| AN-03 | analytics | Privacidade entre membros e orgs | — | `analytics.ts` | — | membro | `dashboard-p5.test.ts:185` | VERIFICADA |
| AN-04 | me | Perfil, organizações e papel atual | shell (`org-switcher.tsx`) | `GET /internal/me` (`routes.ts:49`) | `User`, `Member` | autenticado | coberto indiretamente pelos testes de painel | IMPLEMENTADA, NÃO VERIFICADA (sem teste dedicado) |

### 2.9 Super admin

| ID | Domínio/módulo | Função/jornada | UI/entrada | API/serviço | Persistência/integração | Permissão/plano | Evidência | Estado |
|---|---|---|---|---|---|---|---|---|
| AD-01 | admin | Provedores: chave cifrada e mascarada, testar conexão | `/admin/provedores`, `[id]`, `novo` | `admin/providers.ts:64,72,76,101,126,141` | `Provider.apiKeyEnc` | SUPER_ADMIN | `admin.test.ts:55,72,82`, `crypto.test.ts` | VERIFICADA |
| AD-02 | admin | Modelos: ativar, preço em BRL, preços fixos, fallbacks, exclusão | `/admin/modelos`, `[id]`, `novo` | `admin/models.ts:94,102,106,135,171` | `Model` | SUPER_ADMIN | `admin.test.ts:99`, `:161` | VERIFICADA |
| AD-03 | admin | Configurações globais (câmbio, markup, taxas, bônus) | `/admin/precos` | `admin/settings.ts:13,15`, `lib/settings.ts` | `Setting` | SUPER_ADMIN | `admin.test.ts:126` | VERIFICADA; validação por chave (D-07) sem teste |
| AD-04 | admin | Dashboard de margem e passivo | `/admin` | `admin/dashboard.ts:46`, `routes.ts:38` | `UsageLog`, `Wallet` | SUPER_ADMIN | `admin-panel.test.ts:102`, `:129` | VERIFICADA |
| AD-05 | admin | Clientes: suspender, reativar, mudar cobrança, com auditoria | `/admin/clientes`, `[id]` | `admin/organizations.ts:57,101,140,197` | `Organization`, `AuditLog` | SUPER_ADMIN | `admin-panel.test.ts:154`, `organizations.test.ts:143` | VERIFICADA |
| AD-06 | admin | Listar e revogar chaves de cliente | `/admin/clientes/[id]` (`admin-api-keys.tsx`) | `organizations.ts:257,284` | `ApiKey` | SUPER_ADMIN | `admin-panel.test.ts:210` | VERIFICADA |
| AD-07 | admin | Pacotes globais | `/admin/pacotes` | `admin/packages.ts:17,25,46,71` | `CreditPackage` | SUPER_ADMIN | `admin-panel.test.ts:315` | VERIFICADA |
| AD-08 | admin | Uso entre clientes | `/admin/uso` | `admin/usage.ts:25` | `UsageLog` | SUPER_ADMIN | `admin-panel.test.ts:337` | VERIFICADA |
| AD-09 | admin | Webhooks recebidos e reprocessamento | `/admin/webhooks` | `admin/operations.ts:56,94` | `InboundWebhookEvent`; fila | SUPER_ADMIN | `admin-panel.test.ts:357` | VERIFICADA |
| AD-10 | admin | Auditoria e status do sistema | `/admin/auditoria`, `/admin/sistema` | `operations.ts:110,155` | `AuditLog`, Redis | SUPER_ADMIN | `admin-panel.test.ts:154` (filtra `/audit`), `:385` | VERIFICADA |
| AD-11 | admin | Pagamentos de todos os clientes | `/admin/pagamentos` | `payments/routes.ts:201` | `Payment` | SUPER_ADMIN | `payments.test.ts:258` | VERIFICADA |

### 2.10 Email, saúde e infraestrutura de execução

| ID | Domínio/módulo | Função/jornada | UI/entrada | API/serviço | Persistência/integração | Permissão/plano | Evidência | Estado |
|---|---|---|---|---|---|---|---|---|
| EM-01 | email | Envio via VeloMail com retentativa de 429 | — | `lib/mailer.ts` | VeloMail | — | `velomail.test.ts:53,61,70,82,95` (fetch falso) | VERIFICADA (fake); envio real BLOQUEADO |
| EM-02 | email | Webhook de eventos do VeloMail com assinatura | VeloMail | `POST /webhooks/velomail` (`email-webhooks/routes.ts:51`) | `EmailEvent` | assinatura | `velomail.test.ts:150,162,170,175,187` | VERIFICADA |
| H-01 | health | `/health` da API, request id, JSON envenenado, preflight | nginx/monitor | `health/routes.ts:7`, `app.ts` | Postgres, Redis | público | `health/routes.test.ts` (4) | VERIFICADA |
| H-02 | health | `/api/health` do web | nginx | `apps/web/app/api/health/route.ts` | — | público | nenhum | IMPLEMENTADA, NÃO VERIFICADA |
| L-01 | logs | Logger sem tokens em path/query (S-06) | — | `lib/logger.ts` | — | — | `logger.test.ts` (2) | VERIFICADA |
| W-01 | worker | Agendamento dos jobs periódicos e consumo da fila | processo `worker.ts` | `worker.ts:45-56`, `lib/jobs.ts` | Redis/BullMQ | — | handlers testados diretamente; o processo não foi executado | IMPLEMENTADA, NÃO VERIFICADA |
| I-01 | deploy | Deploy só via Actions na `main` → `deploy.sh` | GitHub | `.github/workflows/deploy.yml`, `deploy/deploy.sh` | VPS | dono | inspeção; detalhes em [RELATORIO_PERFORMANCE_VPS.md](RELATORIO_PERFORMANCE_VPS.md) | BLOQUEADA (sem execução nesta auditoria) |
| I-02 | dados | Backup diário com retenção de 7 dias (PRD §825) | — | só `pg_dump` antes do deploy (`deploy.sh:133-150`) | disco da VPS | — | inspeção (D-04/V-01) | NÃO LOCALIZADA |

### 2.11 Web pública, docs, SDK, React e exemplo

| ID | Domínio/módulo | Função/jornada | UI/entrada | API/serviço | Persistência/integração | Permissão/plano | Evidência | Estado |
|---|---|---|---|---|---|---|---|---|
| U-01 | marketing | Landing | `/` (`(marketing)/page.tsx`) | — | — | público | inspeção (P-01, P-02) | PARCIAL (página provisória "Em construção") |
| U-02 | legal | `/termos` e `/privacidade` (PRD §11.2, §12) | links em `sign-up-form.tsx:100,104` | — | — | público | não há rotas em `apps/web/app` | NÃO LOCALIZADA |
| U-03 | LGPD | Exclusão de conta e exportação de dados (PRD §12) | — | — | — | — | nenhuma rota encontrada | NÃO LOCALIZADA |
| U-04 | web | Páginas do painel e do admin (39 `page.tsx`) | `apps/web/app/(dashboard)`, `(admin)` | `lib/api.ts` → API | — | por layout | `pnpm typecheck` OK; sem E2E | IMPLEMENTADA, NÃO VERIFICADA |
| U-05 | web | Páginas de erro, 404 e loading em pt-BR (P-04) | `app/error.tsx`, `global-error.tsx`, `not-found.tsx`, `loading.tsx` (novos) | — | — | — | criadas nesta auditoria, sem execução | IMPLEMENTADA, NÃO VERIFICADA |
| U-06 | web | Cabeçalhos de segurança (S-07) | todas | `apps/web/next.config.ts` | — | — | typecheck OK; cabeçalhos não observados em execução | IMPLEMENTADA, NÃO VERIFICADA |
| U-07 | checkout | Checkout hospedado `/pay/{id}` (estados de carregando, pago, expirado, estornado) | `app/pay/[checkoutId]/hosted-checkout.tsx` | `GET /public/checkout/:publicId` | — | link público | API: `end-users.test.ts:245`; UI sem E2E | IMPLEMENTADA, NÃO VERIFICADA (UI) |
| DOC-01 | docs | Conteúdo das docs, `llms.txt`, guia por stack, FUSAI.md | `/docs`, `/docs/[slug]`, `/docs-md/[slug]`, `/llms.txt`, `/llms-full.txt` | `packages/docs` | — | público | `docs.test.ts` (6) | VERIFICADA (conteúdo); rotas web não executadas |
| SDK-01 | sdk | Cliente: renovação de token, erro tipado, stream, `verifyWebhook` | apps dos clientes | `packages/sdk/src/client.ts`, `server.ts` | — | — | `sdk.test.ts` (7), `account.test.ts` (3) | VERIFICADA |
| SDK-02 | sdk | `waitForPayment` resiste a erro de rede (D-17) | — | `client.ts:214-225` | — | — | nenhum | IMPLEMENTADA, NÃO VERIFICADA (falha conhecida por inspeção) |
| RC-01 | react | `<FusaiCheckout/>`, `<FusaiBalance/>`, `<FusaiTopup/>` | apps dos clientes | `packages/react/src/*` | — | — | nenhum teste | IMPLEMENTADA, NÃO VERIFICADA |
| X-01 | exemplo | PWA de exemplo: session token, créditos, webhook | `examples/next-pwa` | `app/api/session`, `api/fusai/[...path]`, `api/webhooks/fuse` | — | — | nenhum teste; o GET do webhook expõe eventos (D-20) | IMPLEMENTADA, NÃO VERIFICADA |

## 3. Integrações externas

| Integração | Uso | Autenticação | Teste local | Estado real |
|---|---|---|---|---|
| Asaas (Pix) | cliente, cobrança, QR, cancelamento, estorno, webhook | API key no servidor; token do webhook comparado em tempo constante | `test/fake-asaas.ts` | não exercitado contra sandbox ou produção nesta auditoria |
| Provedores de IA (DeepSeek, Kimi, GLM, Qwen, MiniMax, OpenRouter) | chat via API OpenAI-compatível | chaves em AES-256-GCM | `test/fake-upstream.ts`, `fake-llm.ts` | não exercitado (custo real) |
| VeloMail | envio de emails e eventos | chave `re_`, webhook assinado | fetch falso | não exercitado |
| GitHub Actions + VPS | deploy | segredos do repositório | — | só leitura (ver relatório de VPS) |

## 4. Lacunas do inventário

- Nenhuma jornada web foi executada em navegador (Playwright não foi rodado). Por isso as linhas de UI ficam como **não verificadas**, mesmo quando a API por trás está verificada.
- O processo `worker.ts` não foi iniciado. Os handlers foram testados chamando as funções diretamente.
- Os números de linha refletem o código em 2026-10-22, com edições paralelas em andamento em `gateway`, `billing`, `mcp`, `auth` e `apps/web`.
