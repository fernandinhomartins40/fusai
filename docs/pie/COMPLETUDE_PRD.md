# Completude do PRD — auditoria PIE

- **Data:** 2026-10-22. **Base:** commit `43dd2c3` + mudanças locais sem commit (rodadas PIE 1 e 2).
- **Método:** leitura do PRD seção por seção, confrontada com o código atual (rotas, schema, telas, testes). O `docs/PROGRESS.md` foi usado só como pista; cada item foi conferido no código.
- **"Teste" na coluna Evidência:** nome de um teste automatizado existente que cobre o comportamento. A suíte não foi rodada de novo por este agente; a última execução completa registrada é 231/231 da API (agente de Segurança, 2026-10-22).
- **Estados:** IMPLEMENTADO · PARCIAL (falta parte) · AUSENTE · FORA DE ESCOPO (o PRD manda para a fase 2 ou uma decisão do dono em `docs/DECISIONS.md` substitui o requisito).

## Resumo

| Estado | Quantidade |
|---|---|
| IMPLEMENTADO | 84 |
| PARCIAL | 13 |
| AUSENTE | 11 |
| FORA DE ESCOPO | 10 |
| **Total** | **118** |

O núcleo do produto está implementado e coberto por testes: gateway, cobrança, Pix, usuários finais, checkout, SDK/React, MCP, painéis do cliente e do admin, e-mails (VeloMail) e LGPD técnica.

**O que impede o produto de estar completo segundo o PRD:**
1. **Landing (Fase 9):** é um placeholder "Em construção". Faltam 8 das 10 seções, as páginas `/precos` e `/modelos`, SEO (sitemap, robots, Open Graph, JSON-LD) e um endpoint público de modelos para a tabela e a calculadora.
2. **Fase 10 (resto):** não há e2e Playwright no repositório nem no CI, nem README na raiz (deploy e aviso sobre os termos dos provedores).
3. **Validações externas nunca feitas:** Asaas sandbox real, provedor de IA real e envio real pela VeloMail; também não há medição de desempenho (p95 do gateway, Lighthouse).
4. **SDK e React não publicáveis:** exportam TypeScript sem build, então não dá para instalar pelo npm num app de fora do monorepo.

## Tabela

| Seção PRD | Requisito | Estado | Evidência | O que falta | Esforço |
|---|---|---|---|---|---|
| §2.1/§3 | Monorepo Turborepo + pnpm, TS strict, Biome | IMPLEMENTADO | `turbo.json`, `pnpm-workspace.yaml`, `biome.json`; `pnpm typecheck`/`lint` verdes (RELATORIO_VALIDACAO_FINAL) | — | — |
| §3 | Next 15 + Tailwind 4 + shadcn-style + lucide + Recharts + TanStack Query + react-hook-form + zod | IMPLEMENTADO | `apps/web/package.json`; `components/charts/*`, `components/query-provider.tsx` | — | — |
| §3/§11.1 | TanStack Table e Command (busca) | PARCIAL | `packages/ui/src/components/table.tsx` (tabela própria, sem TanStack Table); sem `cmdk` | Command/busca global; ordenação de tabela | M |
| §3 | Fastify 5 + zod type provider | IMPLEMENTADO | `apps/api/src/app.ts` | — | — |
| §3/§12 | Better Auth (email+senha, verificação, Google opcional) | IMPLEMENTADO | `modules/auth/auth.ts`; teste `auth.test.ts`, `mfa.test.ts` | — | — |
| §3 | Proxy Caddy | FORA DE ESCOPO | D-106 (nginx do host, VPS compartilhada), D-107 | — | — |
| §3 | Email Resend | FORA DE ESCOPO | D-116 (VeloMail no lugar do Resend) | — | — |
| §3/§15 F10 | Playwright (e2e mínimo) | AUSENTE | nenhum `playwright` em `package.json` do repo; PROGRESS Fase 10 "e2e Playwright no CI" pendente | Suíte e2e no repo + job no CI (cadastro → recarga com fake PSP → chave → chamada → extrato) | M |
| §4 | Estrutura do monorepo (apps/web, apps/api, packages db/shared/ui/sdk/react/config, docs) | IMPLEMENTADO | árvore do repo; `packages/docs` a mais (D-095) | — | — |
| §4 | Worker com outro entrypoint (`src/worker.ts`) | IMPLEMENTADO | `apps/api/src/worker.ts` | — | — |
| §5.1 | Dinheiro em micros BigInt, centavos no Pix, `costForTokens` arredondando para cima | IMPLEMENTADO | `packages/shared/src/money.ts`; teste `money.test.ts`, `pricing.test.ts` | — | — |
| §5.2 | Hierarquia Org → Membership/Wallet/Project → ApiKey/CreditPackage/AppUser | IMPLEMENTADO | `packages/db/prisma/schema.prisma` | — | — |
| §5.3 | Modos ORG_WALLET / END_USER_WALLET / HYBRID | IMPLEMENTADO | `modules/gateway/billing.ts`; teste `end-users.test.ts` "END_USER_WALLET without credits answers 402; HYBRID falls back…" | — | — |
| §5.4 | billingType PREPAID / INTERNAL | IMPLEMENTADO | teste `gateway.test.ts` "does not debit INTERNAL organizations…" | — | — |
| §5.4 | POSTPAID com `creditLimitMicros` | FORA DE ESCOPO | D-128 (pré-pago sem exceção; pós-pago desativado) | — | — |
| §6.1 | Seed: admin, org interna, settings, 6 provedores DISABLED, modelos "verificar", pacotes R$ 20/50/100/300 | IMPLEMENTADO | `packages/db/prisma/seed.ts:16-207` (`min_topup_cents` = 500 por D-122) | — | — |
| §7.1 | `GET /v1/models` com `pricing` em BRL | IMPLEMENTADO | `modules/gateway/routes.ts:90`; teste "lists allowed models with BRL pricing…" | — | — |
| §7.1 | `POST /v1/chat/completions` (normal e stream) | IMPLEMENTADO | `modules/gateway/chat.ts`; testes "completes without streaming…", "streams chunk by chunk…" | — | — |
| §7.1 | `GET /v1/balance`, `GET /v1/usage` | IMPLEMENTADO | `routes.ts:120,143`; teste "exposes balance and usage, guarded by scopes" | — | — |
| §7.1 | Header `X-Fuse-User` | IMPLEMENTADO | `gateway/auth.ts`; teste "X-Fuse-User charges that user" | — | — |
| §7.1 | Erros no formato OpenAI (402/403/429/502/401) | IMPLEMENTADO | `gateway/errors.ts`; testes 402, 401, rpm, 400 | — | — |
| §7.2 | `OpenAICompatibleProvider` para todos os provedores | IMPLEMENTADO | `providers/openai-compatible.ts` | — | — |
| §7.2 | `stream_options.include_usage`; estimativa tiktoken + `usage_estimated` | IMPLEMENTADO | `gateway/usage.ts`; teste "estimates usage when the provider does not report it" | — | — |
| §7.2 | Reescrever `model`, esconder provedor e URL | IMPLEMENTADO | D-047; teste `sse.test.ts` | — | — |
| §7.2 | Desconexão do cliente aborta upstream e cobra o gerado | IMPLEMENTADO | teste "aborts the upstream when the client disconnects…" (R-03 em aberto para chamadas sem stream) | — | — |
| §7.3 | Fallback antes do 1º token; sem fallback depois | IMPLEMENTADO | teste "falls back to another provider on 5xx before the first token" | — | — |
| §7.3 | Circuit breaker (5 falhas/60 s → 30 s aberto) | IMPLEMENTADO | `gateway/circuit-breaker.ts`; teste "opens the circuit after 5 failures…" | — | — |
| §7.4 | Reserva atômica → liquidação; job de reservas órfãs | IMPLEMENTADO | `billing/wallet.ts`; testes `wallet.test.ts` (50 reservas concorrentes, holds expirados) | — | — |
| §7.5 | Preço efetivo AUTO/FIXED, markup por org, cache de input | IMPLEMENTADO | `lib/model-pricing.ts`, `shared/pricing.ts`; teste `pricing.test.ts`, admin "activates a model and shows the BRL price…" | — | — |
| §7.5 | Cache de preço por 60 s | FORA DE ESCOPO | D-051 (catálogo em cache por 10 s, invalidado nas escritas) | — | — |
| §7.6 | rpm por chave (janela deslizante Redis) | IMPLEMENTADO | `lib/rate-limit.ts:28`; teste "enforces the per-key requests-per-minute limit" | — | — |
| §7.6 | 30/min por IP no checkout público | IMPLEMENTADO | `modules/payments/routes.ts:278` | — | — |
| §7.6 | Limite de gasto mensal por chave na reserva | IMPLEMENTADO | `wallet.ts` (`reserve` com trava por chave); testes "stops at the monthly spend limit", `pie-receita` R-04/R-05 | — | — |
| §8 | Formato `fai_live_`/`fai_test_` + 40 base62; só hash com pepper; prefixo; comparação em tempo constante | IMPLEMENTADO | `modules/api-keys/keys.ts`; teste `keys.test.ts` | — | — |
| §8 | Chaves test: só modelos baratos, sandbox de pagamento, mesma carteira | IMPLEMENTADO | D-040; teste "restricts TEST keys to cheap models"; D-101 | — | — |
| §8 | Escopos; padrão "todos" | FORA DE ESCOPO | decisão do dono O-12 (painel cria só `chat`; API sem `scopes` mantém todos) — D-129+ | — | — |
| §8 | Painel: criar, renomear, limites, revogar, último uso | IMPLEMENTADO | `components/api-keys/*` (edit-key-form novo); teste `dashboard/api-keys.test.ts` | — | — |
| §9.1 | Recarga por pacote ou valor livre ≥ mínimo | IMPLEMENTADO | teste `payments.test.ts` "validates amounts, applies the top-up fee and honours the Idempotency-Key" | — | — |
| §9.1 | Customer Asaas + cobrança Pix + QR | IMPLEMENTADO | `payments/asaas.ts`; teste "creates the Asaas customer, the Pix charge and returns the QR code" (fake Asaas) | Validação no sandbox real | P |
| §9.1 | Polling 3 s (ou SSE `/events`) | IMPLEMENTADO | polling em `topup-dialog.tsx`/`hosted-checkout.tsx`; o PRD aceita qualquer um | SSE (opcional) | — |
| §9.1 | Webhook com token, idempotente, 200 imediato e fila | IMPLEMENTADO | testes "credits exactly once even when the webhook is delivered 3 times", "rejects webhooks with a wrong token" | — | — |
| §9.1 | E-mail de confirmação + `payment.received` | IMPLEMENTADO | `lib/email-templates.ts:61`; outbox D-086 | — | — |
| §9.1 | `PAYMENT_REFUNDED` pode deixar saldo negativo | FORA DE ESCOPO | D-128 (nunca negativo) + D-131 (estorno proporcional, chargeback congela) | — | — |
| §9.1 | Job de expiração | IMPLEMENTADO | teste "expires unpaid charges, cancels them at Asaas, and still credits a late payment" | — | — |
| §9.2 | Interface `PaymentProvider` + `AsaasProvider` | IMPLEMENTADO | `payments/types.ts`, `payments/asaas.ts` | — | — |
| §9.3 | `POST/GET /v1/app-users`, session token `fai_st_` 15 min | IMPLEMENTADO | `gateway/end-users.ts:82-102`; teste "session tokens: scoped, origin-checked…" | — | — |
| §9.3 | `GET /v1/packages`, `POST /v1/checkout/pix`, `GET /v1/checkout/:id` | IMPLEMENTADO | `gateway/end-users.ts:127-193`; teste "end user buys a package via Pix…" | — | — |
| §9.3 | CORS por `allowedOrigins` para session token; secret key recusada no browser | IMPLEMENTADO | testes "a secret key in a browser is refused", "CORS: /v1 reflects…" | — | — |
| §9.3 | Checkout hospedado `/pay/[id]` com `return_url` | IMPLEMENTADO | `app/pay/[checkoutId]/`; teste `return-url.test.ts`; PROGRESS F7 (navegador) | — | — |
| §9.3 | `@fusai/react` `<FusaiCheckout/>`, `<FusaiBalance/>` | IMPLEMENTADO | `packages/react/src/index.ts` (+ `FusaiTopup`) | Build para npm | — |
| §9.3 | `@fusai/sdk` TS (browser e RN) | PARCIAL | `packages/sdk/src/client.ts`; testes `sdk.test.ts`, `account.test.ts` | Build ESM/CJS + `.d.ts` publicável no npm (hoje exporta `.ts`; PROGRESS F7) | M |
| §9.3 | Aviso sobre lojas iOS/Android na doc e landing | PARCIAL | doc `packages/docs/content/07-checkout-pix.md` | Na landing (FAQ "apps nativos") | P |
| §9.4 | Eventos de saída, HMAC `X-Fuse-Signature`, retry 1m…12h, 6 tentativas | IMPLEMENTADO | teste "signs webhook deliveries with HMAC and retries with backoff" | — | — |
| §9.4 | Tela de logs com reenvio manual | IMPLEMENTADO | `app/(dashboard)/app/(main)/webhooks`; API `/internal/projects/:id/webhooks/:hookId/resend` | — | — |
| §10.1 | MCP Streamable HTTP stateless, auth com escopo `mcp` | IMPLEMENTADO | `mcp/routes.ts:98`; D-097; teste "rejects missing keys, session tokens and keys without the mcp scope" | — | — |
| §10.1 | 11 tools, 4 resources, 3 prompts | IMPLEMENTADO | `mcp/server.ts`; teste "lists every tool, resource and prompt of PRD §10.1" | — | — |
| §10.1 | Toda chamada MCP gera AuditLog | IMPLEMENTADO | `mcp/server.ts:71-85` | — | — |
| §10.1 | OAuth 2.1 do MCP | FORA DE ESCOPO | o próprio PRD manda para a fase 2 | — | — |
| §10.2 | Kit: comandos MCP, `.env`, baixar FUSAI.md, prompt sugerido, migrar do OpenAI | IMPLEMENTADO | `projetos/[id]/integracao/page.tsx:83`, `components/integration/download-fusai-md.tsx` | — | — |
| §10.3 | `/docs` com as 11 seções | IMPLEMENTADO | `packages/docs/content/01..12` (12 arquivos; Markdown em vez de MDX por D-095); teste `docs.test.ts` | — | — |
| §10.3 | `/llms.txt` e `/llms-full.txt` | IMPLEMENTADO | `app/llms.txt/route.ts`, `app/llms-full.txt/route.ts` | — | — |
| §11.1 | Dark-first, Geist, gradiente da marca, logo | IMPLEMENTADO | D-004, D-114; `packages/ui/src/components/logo.tsx` | — | — |
| §11.1 | Acessibilidade AA, foco, teclado | PARCIAL | correções P-07…P-31 (contraste medido, skip link, aria) | Auditoria com leitor de tela e Lighthouse a11y não executadas | P |
| §11.2 | Header com Modelos/Preços/Docs/Entrar/"Começar grátis" | PARCIAL | `(marketing)/page.tsx:52` (só "Entrar") | Links Modelos, Preços, Docs e CTA | P |
| §11.2 | Hero com CTAs "Criar conta"/"Ver docs" | PARCIAL | `(marketing)/page.tsx:58-80` (selo "Em construção") | Bloco de código animado, copy final | P |
| §11.2 | Modelos suportados, Como funciona, Recursos | AUSENTE | `(marketing)/page.tsx` tem só 3 cartões genéricos (`:82-93`) | 3 seções | M |
| §11.2 | Calculadora de preço interativa | AUSENTE | — | Componente + dados públicos de modelos | M |
| §11.2 | Tabela de modelos com dados reais de `/v1/models` públicos | AUSENTE | `/v1/models` exige chave com escopo `chat` (`gateway/routes.ts:90-94`); campo `Model.public` existe sem uso público | Endpoint público (ex.: `/public/models`) + tabela | M |
| §11.2 | Para devs (snippets em abas + comando MCP), FAQ, CTA final | AUSENTE | — | 3 seções; FAQ depende de respostas do dono (créditos expiram?) | M |
| §11.2 | Footer com termos, privacidade, contato, CNPJ | PARCIAL | `components/site-footer.tsx` (termos e privacidade) | CNPJ e contato em `apps/web/lib/legal.ts` (placeholders) | P (dono) |
| §4/§11.2 | Páginas `/precos` e `/modelos` | AUSENTE | não existem em `app/(marketing)/` | 2 páginas | M |
| §11.2 | SEO: metadata, `opengraph-image`, `sitemap.ts`, `robots.ts`, JSON-LD | AUSENTE | nenhum desses arquivos em `apps/web/app` | 4 arquivos + JSON-LD | P |
| §11.2/§15 F9 | Lighthouse ≥ 90 mobile | AUSENTE | nunca medido | Medir após a landing | P |
| §11.3 | Cadastro + verificação de email | IMPLEMENTADO | `(auth)/cadastro`, `verificar-email`; teste `auth.test.ts` | — | — |
| §11.3 | Onboarding 3 passos (org + CPF/CNPJ + telefone → projeto → chave + Kit) | IMPLEMENTADO | `components/onboarding/organization-step.tsx:59`, `key-step.tsx` (leva ao Kit, P-08); teste `routes.test.ts` | — | — |
| §11.3 | Bônus de boas-vindas configurável | IMPLEMENTADO | `welcome_bonus_micros` em `shared/schemas/admin.ts:128`, `dashboard/organizations.ts` | — | — |
| §11.4 | Sidebar com os 9 itens (+ Agente de IA) | IMPLEMENTADO | `components/shell/nav-config.ts:42-51` | — | — |
| §11.4 | Visão geral: saldo, gasto hoje/7d/30d, gráficos, alerta, "Adicionar créditos" | IMPLEMENTADO | `(main)/page.tsx`; `charts/*`; teste `dashboard-p5.test.ts` "buckets usage by São Paulo day…" | — | — |
| §11.4 | Projeto: abas Visão geral, Chaves, Kit, Usuários finais (busca, ajuste), Pacotes, Modelos, Configurações | IMPLEMENTADO | `projetos/[id]/*` (7 páginas); teste "dashboard: packages CRUD, end users list and manual adjustment" | — | — |
| §11.4 | Carteira: extrato paginado, CSV, recarga com QR/status/confetti, histórico | IMPLEMENTADO | `carteira/page.tsx`, `topup/confetti.tsx`; teste "exports the ledger as CSV, neutralizing formulas" | — | — |
| §11.4 | Consumo com filtros, gráficos e CSV | IMPLEMENTADO | `consumo/page.tsx`; teste "filters usage, exports CSV safely and paginates logs" | — | — |
| §11.4 | Logs sem conteúdo de mensagens | IMPLEMENTADO | `UsageLog` sem campo de conteúdo (`schema.prisma`) | — | — |
| §11.4 | Webhooks: URL, segredo revelar/rotacionar, histórico com reenvio | IMPLEMENTADO | teste "rotates and reveals an encrypted webhook secret" | — | — |
| §11.4 | Equipe: convites e papéis | IMPLEMENTADO | testes "invites by email…", "protects owners…" | — | — |
| §11.4 | Configurações: org, CPF/CNPJ, alerta de saldo, recarga sugerida | IMPLEMENTADO | `components/org-settings-form.tsx`; teste "updates organization settings…"; e-mail de saldo baixo (O-06) `balance-alert.test.ts` | — | — |
| §11.5 | Dashboard admin: receita, custo, margem, top clientes/modelos, passivo, erros, req/min | IMPLEMENTADO | `admin/dashboard.ts`, `(admin)/admin/page.tsx:112-120`; teste "dashboard shows charged, provider cost, margin and wallet liability" | — | — |
| §11.5 | Clientes: busca, detalhe, ajustar saldo com motivo, suspender, margem especial, impersonate com banner | IMPLEMENTADO | `admin/organizations.ts`; testes "suspends…", "impersonates a customer with an audit trail…" | — | — |
| §11.5 | Clientes: limite de crédito pós-pago | FORA DE ESCOPO | D-128 | — | — |
| §11.5 | Provedores: CRUD, chave cifrada mascarada, testar conexão, prioridade, timeout | IMPLEMENTADO | testes "stores provider keys encrypted and only returns a mask", "tests the connection…" | — | — |
| §11.5 | Provedores: saúde (latência, erros, circuit breaker) | IMPLEMENTADO | `admin/readiness.ts:107`, `components/admin/provider-health.tsx`; teste `readiness.test.ts` | — | — |
| §11.5 | Modelos: CRUD, custos, AUTO/FIXED, multiplicador, preço ao vivo, fallbacks, capacidades, ativo/público, simulador de margem | IMPLEMENTADO | `admin/models.ts`, `components/admin/price-preview.tsx`; testes "validates fixed prices, fallbacks and deletion", `pie-margin.test.ts` | — | — |
| §11.5 | Preços globais (câmbio, margem, taxa, mínimo, bônus) | IMPLEMENTADO | `admin/settings.ts`; teste "applies new global settings immediately" | — | — |
| §11.5 | Job diário de câmbio (opcional) | AUSENTE | câmbio manual; readiness alerta se tiver mais de 7 dias (`readiness.ts:10`) | Job de cotação (opcional no PRD) | P |
| §11.5 | Pacotes globais | IMPLEMENTADO | teste "manages global packages shown in the customer top-up" | — | — |
| §11.5 | Pagamentos: filtros, reprocessar, estornar | IMPLEMENTADO | `payments/routes.ts:201-236`; teste "refunds: admin requests it at Asaas…" | — | — |
| §11.5 | Uso, Webhooks recebidos (reprocessar), Auditoria, Sistema | IMPLEMENTADO | testes "explores usage…", "lists inbound webhooks and reprocesses one…", "reports system status" | — | — |
| §12 | Cookies httpOnly/secure/sameSite, domínio de prod | IMPLEMENTADO | `modules/auth/auth.ts` (`sameSite`, `COOKIE_DOMAIN`) | — | — |
| §12 | Chaves de provedor AES-256-GCM | IMPLEMENTADO | `lib/crypto.ts`; teste `crypto.test.ts` | — | — |
| §12 | zod, helmet, CORS restrito | IMPLEMENTADO | `app.ts` (helmet); teste "blocks cross-origin mutations…" | CSP bloqueante (hoje Report-Only, S-07) | P |
| §12 | Rate limit em login/cadastro e checkout | IMPLEMENTADO | `lib/rate-limit.ts`; trava por conta S-05 (`auth.test.ts`) | — | — |
| §12 | Ação administrativa → AuditLog | IMPLEMENTADO | `lib/audit.ts` (com `impersonatedBy`, S-04) | — | — |
| §12 | LGPD: termos e privacidade (rascunho), exclusão de conta, export, minimização | PARCIAL | `(marketing)/termos`, `privacidade`, `modules/privacy/*`; teste `privacy.test.ts` (10) | Textos revisados pelo jurídico; preencher `apps/web/lib/legal.ts`; tirar o aviso `draft` | P (dono) |
| §12 | Registrar no README os termos dos provedores (revenda) | AUSENTE | não há `README.md` na raiz | README com aviso e checklist do dono | P |
| §12 | Fiscal (NFS-e) | FORA DE ESCOPO | PRD §2.2 (fase 2); `Organization.asaasWalletId` "phase 2" | — | — |
| §13 | `.env.example` completo | IMPLEMENTADO | `.env.example` (com VeloMail, segredos fortes) | — | — |
| §14.1 | Docker dev: Postgres 16, Redis 7, Mailpit | IMPLEMENTADO | `docker-compose.yml` | — | — |
| §14.2 | Prod: web, api, worker, migrate, postgres, redis, healthchecks, só proxy exposto, não-root | PARCIAL | `deploy/docker-compose.vps.yml` (7 healthchecks), `Dockerfile` (`USER node`), migração no `deploy.sh:168` | `turbo prune` e imagem alpine (D-112 mantém a imagem completa; redução em andamento pelo agente de Infra) | M |
| §14.2 | Backup diário, retenção de 7 dias, documentado | PARCIAL | `deploy/backup/backup.sh`, `docs/OPERACAO.md` "Backups" | Em implementação pelo agente de Infra; nunca rodou em produção | P |
| §15 F10 | README de deploy (VPS, DNS, webhook do Asaas) | PARCIAL | `docs/OPERACAO.md`, `deploy/setup-host.sh` (DNS), `deploy/asaas-webhook.mjs` | README na raiz apontando para esses passos | P |
| §15 F6/F7 | Aceite no sandbox real do Asaas | PARCIAL | só fake (`apps/api/test/fake-asaas.ts`); PROGRESS F6/F7 | Rodar o roteiro com chave sandbox | P (dono: chave) |
| §15 F4 | Aceite com provedor de IA real | PARCIAL | só `fake-llm.ts`/`fake-upstream.ts`; teste "gateway with the official OpenAI SDK…" com upstream falso | Chamada real à DeepSeek | P (dono: chave) |
| §16 | Overhead p95 < 50 ms; 1º byte < 30 ms | AUSENTE | nunca medido (PROGRESS F4) | Benchmark com upstream falso | P |
| §16 | Logs pino com `requestId`, sem segredos | IMPLEMENTADO | `lib/logger.ts`; teste `logger.test.ts` (S-06) | — | — |
| §16 | Paginação por cursor | IMPLEMENTADO | `cursor` em `admin/*`, `dashboard/*` | — | — |
| §16 | Exibição em America/Sao_Paulo, armazenamento UTC | IMPLEMENTADO | `lib/time.ts`; D-035; teste "uses the São Paulo calendar…" | — | — |
| §2.2 | Split, cartão/boleto, imagem/áudio/embeddings, IAP | FORA DE ESCOPO | PRD §2.2 | — | — |
| e-mail | Envio transacional (verificação, reset, convite, pagamento, saldo baixo, bloqueio, exclusão, MCP) via VeloMail + webhook | IMPLEMENTADO | `lib/mailer.ts:22-58`, `lib/email-templates.ts`; testes `velomail.test.ts` (11) | Envio real em produção não verificado nesta auditoria | — |
| §15 F7 | App de exemplo `examples/next-pwa` (AppUser, checkout, webhook, consumo) | IMPLEMENTADO | `examples/next-pwa/app/api/{session,webhooks/fuse,fusai}`; PROGRESS "Navegador 19/19" | — | — |

## Itens que dependem do dono

- **Conteúdo da landing:** copy, FAQ ("créditos expiram?", reembolso), CNPJ, contato e texto do rodapé.
- **`apps/web/lib/legal.ts` e revisão jurídica** de Termos e Privacidade.
- **Chaves de teste:** Asaas sandbox e um provedor de IA, para fechar o aceite das Fases 4, 6 e 7.
- **Termos de cada provedor de IA:** confirmar que permitem revenda (PRD §12), para registrar no README.

## Itens que o time técnico pode fazer sem decisão

1. Landing completa, `/precos`, `/modelos`, endpoint público de modelos, SEO e Lighthouse (Fase 9).
2. E2E Playwright no repo e no CI (Fase 10).
3. Build publicável de `@fusai/sdk` e `@fusai/react`.
4. README na raiz (deploy e aviso sobre os termos dos provedores).
5. Benchmark do overhead do gateway.
6. Command/busca global e TanStack Table (baixo impacto).
7. Job diário de câmbio (opcional).
