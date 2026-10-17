# Progresso

| Fase | Status |
|---|---|
| 0 — Fundação | ✅ concluída (ver pendências) |
| 1 — Banco e autenticação | ✅ concluída (ver pendências) |
| 2 — Provedores, modelos e preços | ✅ concluída (ver pendências) |
| 3 — Billing core | ✅ concluída (ver pendências) |
| 4 — Chaves de API e gateway | ✅ concluída (ver pendências) |
| 5 — Painel do cliente | ✅ concluída (ver pendências) |
| 6 — Pix (Asaas) | ✅ concluída — falta validar no sandbox real (ver pendências) |
| 7 — Usuários finais e checkout | ✅ concluída — falta validar no sandbox real (ver pendências) |
| 8 — MCP e Kit de Integração | ✅ concluída (ver pendências) |
| 9 — Landing page | ⏳ |
| 10 — Admin completo e hardening | ⏳ |

## Fase 0 — Fundação

### Feito
- Monorepo Turborepo + pnpm: `apps/web`, `apps/api`, `packages/{config,shared,ui,db}`.
- `packages/config`: tsconfigs base/node/library/next (strict, `noUncheckedIndexedAccess`).
- `packages/shared/money.ts`: `brlToMicros`, `microsToBrl`, `centsToMicros`, `microsToCentsCeil`, `formatBRL`, `costForTokens` (arredonda para cima), `ceilDiv` — 15 testes.
- `packages/ui`: tokens CSS (dark-first + claro, Geist, raio 2xl, gradiente âmbar → rosa → violeta), logo SVG (`assets/logo.svg`, `assets/mark.svg`, componentes `<Logo/>` e `<LogoMark/>`), componentes Button (incl. variante `brand`), Card, Badge, Input, Label.
- `packages/db`: Prisma 6 configurado (modelo `Setting` como esqueleto; schema completo na Fase 1), client singleton.
- `apps/api`: Fastify 5 + zod type provider, helmet, CORS para `APP_URL`, env validado, logs pino com redact, request id propagado, `GET /health` (+ 2 testes).
- `apps/web`: Next 15 App Router + Tailwind v4 + Geist + next-themes; home provisória usando o design system; `GET /api/health`; ícone SVG.
- `docker-compose.yml` (Postgres 16, Redis 7, Mailpit), `.env.example`, `CLAUDE.md`, `docs/`.

### Como testar
```bash
cp .env.example .env
docker compose up -d
pnpm i
pnpm dev
curl http://localhost:4000/health      # {"status":"ok","service":"fuseai-api",...}
curl http://localhost:3000/api/health  # {"status":"ok","service":"fuseai-web",...}
# abra http://localhost:3000 (home provisória, alterne claro/escuro)
pnpm lint && pnpm typecheck && pnpm test
```

### Verificado
- `pnpm lint`, `pnpm typecheck`, `pnpm test` (17 testes) passando.
- `pnpm dev`: API respondeu `/health` 200 em :4000; web respondeu `/api/health` e `/` 200 (testado em :3100 porque a :3000 desta máquina estava ocupada por outro projeto); CSS gerado contém os tokens e utilitários da marca.
- `docker compose config` válido.

### Pendências
- `docker compose up -d` não pôde ser executado aqui: o engine do Docker Desktop retornou erro 500 (WSL com `REGDB_E_CLASSNOTREG`). Rodar localmente após corrigir o Docker/WSL (`wsl --update` ou reinstalar o recurso WSL). Postgres/Redis só são usados a partir da Fase 1.

## Fase 1 — Banco e autenticação

### Feito
- **Schema Prisma completo** (PRD §6): 20 tabelas, incluindo as do Better Auth 1.7 (`user`, `session`, `account`, `verification`) com `role` (`PlatformRole`). Migração `init`.
- **Seed idempotente** (`pnpm db:seed`): super admin (`SEED_ADMIN_EMAIL`/`SEED_ADMIN_PASSWORD`, email já verificado); org `fusai Interno` (`INTERNAL`, carteira, admin como OWNER); settings (câmbio 5,50, margem 4,0, taxa 0, mínimo R$ 10, alerta R$ 5, bônus 0); 6 provedores `DISABLED` sem chave; 6 modelos de exemplo **inativos** com preço “verificar”; 4 pacotes globais (R$ 20, 50 +5%, 100 +10%, 300 +15%). Rodar de novo não sobrescreve alterações do admin.
- **Better Auth na API** em `/api/auth/*`: email+senha com verificação obrigatória (reenvio ao tentar logar), reset de senha (1 h, revoga sessões), Google opcional, rate limit (login/cadastro 5/min; reset e reenvio 3 a cada 5 min), cookies `httpOnly`/`lax`/`secure` em prod e cross-subdomain via `COOKIE_DOMAIN`. `role` nunca é aceito do cliente.
- **Emails** (nodemailer): Mailpit via `SMTP_URL` em dev; SMTP do Resend quando há `RESEND_API_KEY`. Templates pt-BR de verificação e reset.
- **Rotas do painel** (`/internal/*`, sessão por cookie + checagem de `Origin` contra CSRF): `GET /internal/me`, `POST /internal/onboarding/organization` (org + carteira + OWNER + bônus de boas-vindas no ledger), `POST /internal/organizations/:orgId/projects`. Admin: `GET /internal/admin/overview` (só `SUPER_ADMIN`; 401 sem sessão, 403 para usuário comum).
- **Web**: `/entrar`, `/cadastro`, `/recuperar-senha`, `/redefinir-senha`, `/verificar-email`; middleware que manda `/app` e `/admin` sem sessão para `/entrar?next=…`; layouts server-side checam sessão e papel (`forbidden()` → página 403); onboarding em 3 etapas (organização com CPF/CNPJ validado → projeto com modo de cobrança → pronto); visão geral provisória com saldo e projetos; `/admin` com contadores.
- **Shared**: validação de CPF/CNPJ, `slugify`, schemas zod de auth e onboarding usados no front e na API.

### Como testar
```bash
docker compose up -d
pnpm i
pnpm db:migrate        # aplica a migração init
pnpm db:seed
pnpm dev
# 1. http://localhost:3000/cadastro -> crie a conta
# 2. http://localhost:8025 (Mailpit) -> abra "Confirme seu email" e clique no botão
# 3. onboarding: organização (CPF/CNPJ válido, ex. 529.982.247-25) -> projeto -> painel
# 4. http://localhost:3000/admin com esse usuário -> 403
# 5. saia e entre como admin@fusai.com.br / change-me-now -> /admin mostra os contadores
pnpm lint && pnpm typecheck && pnpm test   # testes da API usam o banco fuseai_test (criado automaticamente)
```

### Verificado
- `pnpm lint`, `pnpm typecheck`, `pnpm test` (30 testes: 20 em shared, 10 de integração na API com Postgres real) e `pnpm build` passando.
- Fluxo de aceite executado via HTTP com servidores reais: cadastro → email no Mailpit → login antes de confirmar dá 403 → clique no link (302 com cookie de sessão) → `/app` redireciona ao onboarding → organização + projeto criados → `/app` 200 com saldo e projeto → `/admin` 403 para usuário comum e 307 para `/entrar` sem sessão → admin do seed acessa `/admin` (200). Páginas de auth respondem 200; token de verificação inválido volta com `error=INVALID_TOKEN`; `callbackURL` para outro domínio é bloqueado (403); rate limit de login retorna 429.
- Seed rodado 2× sem duplicar dados.

### Pendências
- Docker continua indisponível nesta máquina (WSL quebrado). A verificação usou Postgres 16 embutido (npm `embedded-postgres`) e Mailpit para Windows, fora do repositório. Rodar o roteiro acima com `docker compose` depois de consertar o WSL.
- Não houve verificação visual em navegador (só HTTP); vale abrir as telas antes de aprovar.
- Rate limit do Better Auth está em memória (um processo). Passa para Redis junto com o rate limit do gateway na Fase 4.
- A etapa “gerar primeira chave + Kit de Integração” do onboarding entra na Fase 4 (chaves) / Fase 8 (kit).
- Navegação completa do painel (sidebar etc.) é da Fase 5; a visão geral atual é provisória.

## Fase 2 — Provedores, modelos e preços (admin)

### Feito
- **`@fusai/shared/pricing`**: fórmula do PRD §7.5 com aritmética decimal exata em BigInt (`decimal.ts`, sem float), sempre arredondando para cima; precedência de margem org > modelo > global; modo FIXED; custo em R$ e margem em basis points. Mesmo código roda na API e no preview do admin.
- **Criptografia** das chaves de provedor com AES-256-GCM (`v1.iv.tag.ciphertext`, IV aleatório), máscara `sk-…abcd`; `ENCRYPTION_KEY` obrigatório e validado no boot.
- **API admin** (só `SUPER_ADMIN`, guarda em `onRequest`, antes da validação do corpo):
  - Provedores: listar/detalhar (chave só mascarada), criar, editar (chave nova substitui; em branco mantém), excluir (bloqueado se houver modelos), **testar conexão** (`GET {baseUrl}/models`, lista os modelos do upstream, latência, erro com a chave apagada da mensagem). Não ativa sem chave. Em produção exige `https`.
  - Modelos: CRUD com preço calculado (entrada, cache, saída, custo em R$, margem); valida provedor, slug único, fallbacks (existem, não é ele mesmo, até 5) e preço fixo; exclusão bloqueada se houver consumo (e limpa referências de fallback).
  - Preços globais: câmbio, margem padrão, taxa de recarga, recarga mínima, alerta de saldo baixo, bônus de boas-vindas. Cache de 60 s por instância, invalidado em toda alteração.
  - Toda alteração gera `AuditLog` (sem segredos; o de settings guarda “de → para”).
- **Web admin**: abas Visão geral · Provedores · Modelos · Preços. Provedores em cards com teste de conexão inline; tabela de modelos com preço R$/1M, margem e toggle de ativação; formulário de modelo com **preço final ao vivo** e **simulador de margem** (receita, custo, lucro, margem para um consumo mensal); formulário de preços globais. Toasts (sonner), componentes novos em `@fusai/ui`: Table, Switch, Select, Textarea.
- API aceita corpo JSON vazio com `content-type: application/json` (parser seguro contra prototype poisoning).

### Como testar
```bash
# .env precisa de ENCRYPTION_KEY válido: openssl rand -base64 32
docker compose up -d && pnpm db:migrate && pnpm db:seed && pnpm dev
# entre como admin@fusai.com.br em http://localhost:3000/admin
# Provedores -> DeepSeek -> Editar: cole a chave, marque "ativo", salve -> "Testar conexão"
# Modelos -> DeepSeek Chat: confira os custos no site oficial -> ative -> veja o preço em R$
# Preços: altere o câmbio e veja os preços dos modelos mudarem
pnpm test   # pricing (shared) + admin (API, com upstream falso)
```

### Verificado
- `pnpm lint`, `pnpm typecheck`, `pnpm test` (54 testes: 31 shared, 23 API) e `pnpm build` passando.
- Aceite via HTTP com servidores reais e um upstream falso compatível com OpenAI no lugar da DeepSeek: ativar sem chave → 400; salvar chave + ativar → máscara `sk-…cdef`; testar conexão → ok, 2 modelos, ~20 ms; chave errada → `ok:false`, 401 com mensagem limpa; ativar `fuse/deepseek-chat` → saída R$ 24,20/1M (1,10 × 5,50 × 4), entrada R$ 5,94, cache R$ 1,54, margem 75%; chave cifrada no banco (sem texto puro); auditoria sem a chave; todas as páginas do admin respondem 200.

### Pendências
- Não testado com chave real da DeepSeek (não há chave neste ambiente); o teste de conexão chama `GET /models`, padrão OpenAI que os provedores-alvo expõem.
- Sem verificação visual em navegador (só HTTP) — vale abrir `/admin/modelos/novo` em 375px.
- Saúde do provedor (latência/erros/circuit breaker) e job diário de câmbio ficam para as Fases 4 e 10.
- Docker continua indisponível nesta máquina.

## Fase 3 — Billing core

### Feito
- **Migrações** `billing_core` (tabela `WalletHold` + `UNIQUE(type, referenceType, referenceId)` no ledger) e `wallet_checks` (`CHECK reservedMicros >= 0` e `amountMicros >= 0` nas holds).
- **`apps/api/src/modules/billing/wallet.ts`**:
  - `applyLedger`: único caminho para mudar saldo (`UPDATE … RETURNING` + `LedgerEntry` com `balanceAfter`), então a soma do ledger sempre bate com o saldo.
  - `reserve`: exatamente o `UPDATE … WHERE balance - reserved + creditLimit >= hold` do PRD §7.4, na mesma transação que cria a `WalletHold` (TTL 15 min). Hold zero ainda exige saldo disponível ≥ 0 (carteira negativa por estorno fica bloqueada).
  - `settle`: libera a hold e debita o custo real (`USAGE`), idempotente por `requestId` (inclusive em liquidações simultâneas); se a hold já expirou, cobra sem mexer no reservado. `release` = liquidar com custo 0.
  - `releaseExpiredHolds`: uma única instrução SQL (CTE) libera holds órfãs.
  - Estimativa de reserva `estimateHoldMicros` em `@fusai/shared` (entrada estimada + min(max_tokens ?? 4096, máx. do modelo) de saída).
- **Worker** `src/worker.ts` (`dev:worker` / `node dist/worker.js`): limpeza de holds a cada 5 min.
- **API**: carteira e extrato paginado por cursor para membros da organização; admin com lista de clientes (busca por nome, slug, CPF/CNPJ, email), detalhe (carteira, holds ativas, conferência ledger × saldo, membros, projetos), extrato e **ajuste manual** (motivo obrigatório, limite de R$ 1.000.000, ledger `ADJUSTMENT` com `actorId` + `AuditLog wallet.adjust`).
- **Web**: abas no painel do cliente (Visão geral · Carteira); `/app/carteira` com saldo/reservado/disponível e extrato com “Carregar mais”; admin `/admin/clientes` (busca e paginação) e `/admin/clientes/[id]` com formulário de crédito/débito.
- Bônus de boas-vindas do onboarding agora passa por `applyLedger` (referência única por organização).

### Como testar
```bash
docker compose up -d && pnpm db:migrate && pnpm db:seed && pnpm dev
# admin: /admin/clientes -> abra um cliente -> lance um crédito com motivo
# cliente: /app/carteira mostra o lançamento; /admin/clientes/[id] mostra "Ledger confere com o saldo"
pnpm --filter @fusai/api dev:worker   # limpeza de reservas órfãs
pnpm test   # inclui o teste de 50 reservas concorrentes
```

### Verificado
- `pnpm lint`, `pnpm typecheck`, `pnpm test` (67 testes: 33 shared, 34 API) e `pnpm build` passando.
- **Critérios de aceite**: 50 reservas concorrentes de R$ 0,03 numa carteira PREPAID de R$ 1,00 → exatamente 33 aceitas, `balance - reserved` nunca negativo (amostrado durante a execução, pool de 25 conexões); carga mista de 50 reservas+liquidações → reservado 0, nenhuma hold restante, soma do ledger = saldo = inicial − cobrado; pós-pago para em −limite; 5 liquidações simultâneas do mesmo request cobram uma vez. **Teste de mutação**: trocando a reserva atômica por "ler e depois atualizar", o teste falha (50 aceitas em vez de 33).
- Fluxo HTTP com servidores reais: admin credita R$ 50 e debita R$ 1,234567 → carteira do cliente R$ 48,77, ambos no extrato de `/app/carteira`, `AuditLog` com valor, motivo e autor; cliente recebe 403 ao tentar ajustar; detalhe do admin mostra ledger conferindo.
- Worker liberou uma hold órfã expirada (reservado 777 → 0).

### Pendências
- Limpeza via BullMQ (job repetível) entra com o Redis na Fase 4; por enquanto `setInterval` no worker.
- Export CSV do extrato e gráficos ficam na Fase 5. Suspender/billingType/limite pós-pago/impersonate na Fase 10 (o modelo já suporta).
- Docker indisponível nesta máquina; verificação feita com Postgres 16 embutido.

## Fase 4 — Chaves de API e gateway

### Feito
- **Chaves de API** (`modules/api-keys`, `modules/dashboard/api-keys.ts`): `fai_live_`/`fai_test_` + 40 base62 (`crypto.randomInt`). No banco ficam só `sha256(key + KEY_PEPPER)` e um prefixo de 12 caracteres; a chave completa aparece uma única vez. Escopos, limite de rpm, limite de gasto mensal, expiração e revogação, com auditoria de criação, edição e revogação.
- **Gateway `/v1`** (`modules/gateway`), com erros no formato OpenAI:
  - `GET /v1/models` (modelos servíveis e permitidos, com preço em R$), `POST /v1/chat/completions` (com e sem stream), `GET /v1/balance`, `GET /v1/usage`.
  - Fluxo do chat: autenticação por Bearer (antes do parse do corpo) → modelo + allow-list do projeto + regra de chave de teste → rate limit por chave (janela deslizante no Redis, padrão 120 rpm) → candidatos (modelo + fallbacks servíveis) → reserva = pior caso entre os candidatos → limite mensal da chave → chamada com fallback em erro retentável antes do 1º token → liquidação + `UsageLog` na mesma transação.
  - Um único `OpenAICompatibleProvider`, parser SSE próprio, timeout por provedor; `stream_options.include_usage` é sempre pedido ao upstream. Sem usage do provedor, estima com `js-tiktoken` (`cl100k_base`) e marca `errorCode usage_estimated`.
  - Stream: repassa chunk a chunk reescrevendo `id`/`model` e removendo campos do provedor; o chunk de usage só aparece se o cliente pediu. Se o cliente desconecta, o upstream é abortado e o que foi gerado é cobrado. A liquidação acontece antes do `[DONE]`.
  - Circuit breaker no Redis (≥ 5 falhas em 60 s → provedor pulado por 30 s).
  - Org `INTERNAL`: sem reserva nem débito, `UsageLog` com cobrança virtual.
- **Redis**: rate limit do Better Auth migrado para o Redis (`customStorage.consume`); worker em **BullMQ** (job `release-holds` a cada 5 min + execução ao iniciar).
- **Configuração** `test_key_max_output_micros` (padrão R$ 50/1M), editável em Admin → Preços.
- **Web**: aba Projetos; página do projeto com tabela de chaves (criar em diálogo, chave exibida uma vez com `.env` e exemplo do SDK OpenAI, revogar); o onboarding termina gerando a primeira chave. Novo `Dialog` em `@fusai/ui` (sobre `<dialog>` nativo).

### Como testar
```bash
docker compose up -d && pnpm db:migrate && pnpm db:seed && pnpm dev
pnpm --filter @fusai/api dev:worker
# Admin: Provedores -> DeepSeek -> cole a chave real e ative; Modelos -> ative fuse/deepseek-chat
# Cliente: Projetos -> projeto -> Nova chave (copie)
```
```ts
import OpenAI from 'openai';
const client = new OpenAI({ apiKey: 'fai_live_...', baseURL: 'http://localhost:4000/v1' });
await client.chat.completions.create({ model: 'fuse/deepseek-chat', messages: [{ role: 'user', content: 'Olá' }] });
```

### Verificado
- `pnpm lint`, `pnpm typecheck`, `pnpm test` (98 testes: 33 shared, 65 API) e `pnpm build` passando.
- **Testes do gateway com o SDK oficial `openai`**, contra a API escutando numa porta real e um upstream falso:
  - com e sem stream, com débito exato (tokens × preço = 242 micros) e chunk de usage só quando pedido;
  - 402 sem saldo (com `UsageLog INSUFFICIENT_FUNDS`) e 401 para chave revogada, expirada ou malformada;
  - fallback em 5xx, e circuit breaker pulando o provedor após 5 falhas;
  - 400 do upstream repassado sem fallback e sem cobrança, e usage estimado quando o provedor não informa;
  - desconexão no meio do stream: upstream abortado, cobrança parcial, reserva liberada;
  - 429 por rpm, org INTERNAL sem débito, allow-list (403), modelo inexistente (404), chave de teste sem modelo caro, limite mensal (402 `spend_limit_reached`);
  - `/v1/balance`, `/v1/usage`, escopos e validação de corpo.
- **Aceite com servidores reais** (Postgres + Redis locais, “DeepSeek” falso):
  - o admin configura o provedor e ativa `fuse/deepseek-chat`; a cliente cria a chave pelo painel;
  - script com o SDK oficial `openai`: resposta com e sem stream, débito de 18.040 micros por chamada (1000 × R$ 5,94 + 500 × R$ 24,20 por 1M), conferido no `/v1/balance`;
  - cliente sem saldo → 402 `insufficient_funds`; chave revogada pelo painel → 401.
- O worker BullMQ liberou uma hold órfã.

### Pendências
- Sem chave real de provedor neste ambiente: falta validar com a DeepSeek de verdade. O campo de cache `prompt_cache_hit_tokens` dela já é tratado.
- Projetos `END_USER_WALLET` respondem 400 `app_user_required` até a Fase 7 (X-Fuse-User / session token). `HYBRID` usa a carteira da org por enquanto.
- Medição do overhead p95 < 50 ms e saúde dos provedores no admin ficam para a Fase 10.
- O Redis do ambiente de verificação é 5.0 (port para Windows) e o BullMQ recomenda ≥ 6.2; o `docker-compose` usa Redis 7.

## Fase 5 — Painel do cliente

### Feito
- **Shell do painel**: sidebar no desktop (Visão geral · Projetos · Carteira · Consumo · Logs · Webhooks · Equipe · Configurações · Docs) e barra rolável no celular, com a aba ativa sempre visível; seletor de organização no cabeçalho quando a pessoa participa de mais de uma (cookie `fuse_org`).
- **Visão geral**: alerta de saldo baixo (limite da org ou o global), KPIs (disponível, gasto hoje/7d/30d com requisições) e gráficos de gasto por dia e por modelo (30 dias, horário de Brasília), cada um com tabela gêmea ("Ver tabela"); bloco "Comece por aqui" enquanto não há uso.
- **Projetos** com abas: Visão geral (KPIs + gráfico do projeto + curl), Chaves de API, Modelos permitidos (restrição opcional + modelo padrão, preços da org) e Configurações (nome, modo de cobrança só para dono/admin, origens CORS, crédito grátis para usuários finais, URL do webhook, segredo do webhook cifrado com revelar/rotacionar).
- **Carteira**: exportação do extrato em CSV.
- **Consumo**: uma linha de filtros (período 1/7/30/90 dias, projeto, modelo) que atualiza a URL; o conteúdo anterior fica esmaecido durante a recarga; KPIs, gráficos, tabela por projeto e CSV (dia × projeto × modelo).
- **Logs**: últimas requisições (modelo, projeto/chave, tokens, custo, latência e 1º token, status), filtros por projeto/status, paginação por cursor, botão atualizar. Sem conteúdo das mensagens.
- **Webhooks**: estado por projeto e lista de eventos. O histórico de entregas fica vazio até a Fase 7, que dispara os eventos.
- **Equipe**: convites por email (token de 32 bytes, só o hash no banco, 7 dias, um convite pendente por email), aceite apenas pelo email convidado, papéis (Dono/Admin/Dev/Financeiro), remover e sair. Admin não mexe em donos e a organização nunca fica sem dono. A página pública `/convite/[token]` leva ao cadastro/login e volta ao convite após confirmar o email.
- **Configurações**: nome, CPF/CNPJ (trocar o documento descarta o cliente Asaas), telefone, alerta de saldo baixo e recarga sugerida.
- **`/docs`**: início rápido (as docs completas são da Fase 8).
- **API** (`modules/dashboard`): `analytics.ts` (overview, usage, usage.csv, logs, ledger.csv), `projects.ts` (PATCH do projeto, segredo de webhook, modelos da org, configurações da org), `team.ts` (membros, convites, papéis). Migração `team_and_org_settings` (`Invitation`, `Organization.lowBalanceAlertMicros`, `suggestedTopupCents`).
- **Gráficos** seguindo a skill de dataviz: uma série, uma cor validada nos dois temas (`#7c3aed` claro / `#8b5cf6` escuro contra as superfícies dos cards), barras ≤ 24px com cantos de 4px na ponta, grid em linha fina sólida, tooltip com o valor em destaque e tabela gêmea.

### Como testar
```bash
docker compose up -d && pnpm db:migrate && pnpm db:seed && pnpm dev
# crie uma conta, confirme no Mailpit, faça o onboarding e chame a API com a chave gerada
# abra /app, /app/consumo, /app/logs, /app/equipe (convide outro email e aceite pelo link no Mailpit)
# teste em 375px (DevTools → dispositivo móvel)
```

### Verificado
- `pnpm lint`, `pnpm typecheck`, `pnpm test` (117 testes: 35 shared, 82 API) e `pnpm build` passando.
- **No navegador** (Chromium headless via Playwright, viewport 375px, servidores reais + Mailpit + "DeepSeek" falso), 27/27 verificações:
  - cadastro pela UI → email no Mailpit → onboarding → primeira chave;
  - crédito pelo admin → 3 chamadas ao gateway → visão geral com o gasto do dia;
  - as 15 páginas do painel sem rolagem horizontal em 375px;
  - filtro de consumo, logs, configurações do projeto e segredo do webhook;
  - convite pela UI → segunda pessoa cria a conta pelo link, confirma o email, volta ao convite, aceita e vê a organização;
  - sem erros no console.
- Capturas conferidas a olho em 375px e 1440px, nos temas escuro e claro.
- **Bugs encontrados no navegador e corrigidos**:
  - CORS bloqueava PATCH/DELETE (afetava também o admin) — corrigido, agora com teste de preflight;
  - o painel ficava com 540px num celular de 375px por causa de blocos de código dentro de `grid` — corrigido no tema;
  - mismatch de hydration no botão de tema para quem usa o tema claro;
  - ticks do eixo Y arredondados de forma enganosa;
  - animação do Recharts escondia os rótulos.

### Pendências
- Histórico de entregas de webhooks e reenvio: Fase 7 (entrega com HMAC e retry).
- Recarga via Pix ("Adicionar créditos" leva à carteira): Fase 6.
- O roteiro de navegador está no scratchpad desta máquina; vira suíte Playwright no repositório na Fase 10.
- Docker continua indisponível aqui (Postgres, Redis e Mailpit locais no scratchpad).

## Fase 6 — Pix (Asaas)

### Feito
- **Documentação oficial do Asaas consultada** (out/2026) antes de codar; divergências do PRD registradas em D-066…D-071.
- **`PaymentProvider` + `AsaasProvider`** (`apps/api/src/payments`): clientes, cobrança Pix, QR Code, consulta de cobrança, estorno, cancelamento e validação do webhook. Header `access_token`, `User-Agent`, URLs de sandbox/produção por `ASAAS_ENV` (ou `ASAAS_API_URL`).
- **Recarga da organização** (`modules/payments`):
  - pacote global ou valor livre (mínimo `min_topup_cents`, máximo R$ 10.000), com taxa opcional `topup_fee_pct` arredondada para cima;
  - cria o cliente no Asaas uma vez por organização (guardado em `asaasCustomerId`), a cobrança com `externalReference = payment.id` e o QR Code;
  - o Pix vale 60 minutos (ou menos, se o Asaas indicar);
  - `Idempotency-Key` evita cobrança dupla em clique duplo; limite de 10 recargas/min por usuário; só dono, admin e financeiro recarregam.
- **Webhook** `POST /webhooks/asaas`:
  - valida `asaas-access-token` em tempo constante;
  - guarda o evento com `eventKey` único (o `id` `evt_…` do Asaas), responde 200 na hora e enfileira `process-webhook`; eventos repetidos são confirmados e ignorados.
- **Crédito único**:
  - o worker consulta a cobrança no Asaas (status pago e valor igual) antes de creditar; só o corpo do webhook nunca basta;
  - o crédito usa `UPDATE … WHERE creditedAt IS NULL` e a chave única do ledger: `PURCHASE` + `BONUS` uma vez só, mesmo com eventos diferentes (`CONFIRMED` e `RECEIVED`) processados em paralelo.
- **Worker BullMQ** (fila `jobs`): `process-webhook`; `expire-payments` (1 min) cancela no Asaas e marca `EXPIRED` (se já foi pago, credita); `sweep-webhooks` (2 min) reprocessa eventos que ficaram para trás; `release-holds` (5 min). Email "Pagamento confirmado" para dono, admin e financeiro.
- **Estorno**: o admin pede em `/admin/pagamentos` → `POST /payments/{id}/refund` no Asaas → o webhook `PAYMENT_REFUNDED` debita `REFUND` uma vez (pode deixar o saldo negativo, bloqueando o uso até regularizar).
- **Web**:
  - "Adicionar créditos" (visão geral e carteira) abre o diálogo: pacotes (com bônus e "popular") ou outro valor → QR Code + copia e cola + contagem regressiva → status ao vivo (TanStack Query, a cada 3 s) → tela de sucesso com confete;
  - a carteira se atualiza sozinha e ganhou o histórico de recargas;
  - admin: página Pagamentos com estorno.

### Como testar
```bash
docker compose up -d && pnpm db:migrate && pnpm db:seed
pnpm dev                                   # API + web
pnpm --filter @fusai/api dev:worker       # processa webhooks, expiração e emails
```
**No sandbox real do Asaas** (critério de aceite da fase):
1. Crie a conta em https://sandbox.asaas.com, cadastre uma chave Pix (Minha conta → Pix) e gere a chave de API (Integrações). Coloque em `.env`: `ASAAS_ENV=sandbox`, `ASAAS_API_KEY=$aact_hmlg_...`, `ASAAS_WEBHOOK_TOKEN=<um token longo>`.
2. Exponha a API (ex.: `cloudflared tunnel --url http://localhost:4000` ou `ngrok http 4000`) e, no Asaas (Integrações → Webhooks), crie um webhook para `https://<túnel>/webhooks/asaas`. Use o mesmo token e marque os eventos `PAYMENT_RECEIVED`, `PAYMENT_CONFIRMED`, `PAYMENT_REFUNDED`, `PAYMENT_OVERDUE` e `PAYMENT_DELETED`.
3. No painel: Carteira → Adicionar créditos → R$ 50 → Gerar Pix.
4. No sandbox do Asaas: Cobranças → abra a cobrança → **Confirmar pagamento**. O diálogo vira "Pagamento confirmado" e o saldo sobe R$ 52,50.
5. Reenvie o mesmo evento 3× (Integrações → Webhooks → logs → reenviar) e confira que o saldo não muda.

### Verificado
- `pnpm lint`, `pnpm typecheck`, `pnpm test` (128 testes: 35 shared, 93 API) e `pnpm build` passando.
- **11 testes de pagamento** contra um Asaas falso fiel à API documentada:
  - criação do cliente, da cobrança e do QR Code (headers `access_token`/`User-Agent`, `externalReference`);
  - webhook entregue 3× → 1 evento, 1 crédito;
  - eventos diferentes processados em paralelo → 1 crédito;
  - token errado → 401 sem gravar nada;
  - evento sem pagamento real, ou com valor divergente → não credita;
  - varredura de eventos pendentes;
  - expiração com cancelamento no Asaas (e crédito se já estava pago);
  - estorno idempotente;
  - validação de valor, taxa, `Idempotency-Key`, falha do Asaas → 502, e permissões.
- **Aceite no navegador** (375px, servidores reais + **worker BullMQ** + Mailpit + Asaas falso na porta 4998), 14/14:
  - cadastro e onboarding pela UI → "Adicionar créditos" → pacote R$ 50 → QR Code e copia e cola;
  - "Confirmar pagamento" simulado com o webhook entregue **3×** (200/200/200) → a tela vira "Pagamento confirmado" sozinha;
  - carteira com R$ 52,50, recarga "Paga" e extrato com compra + bônus; email de confirmação recebido; sem estouro horizontal nem erros no console.
- No banco, após esse fluxo: 1 `InboundWebhookEvent` processado sem erro e exatamente `PURCHASE 50000000` + `BONUS 2500000`.
- **Bugs achados no navegador e corrigidos**: o extrato não se atualizava após um refresh do servidor (estado preso no `LedgerTable`); a carteira atrás do diálogo ficava desatualizada (agora atualiza ao gerar e ao confirmar o Pix).

### Pendências
- **Não validado no sandbox real do Asaas** (sem chave neste ambiente): seguir o roteiro acima. A integração segue a documentação oficial, mas o primeiro teste real pode revelar detalhes (ex.: exigência de chave Pix cadastrada na conta).
- ~~Pagamentos de usuários finais, checkout hospedado e webhooks de saída: Fase 7.~~ Feito na Fase 7.
- Reprocessar webhook recebido pelo admin e notas fiscais: Fase 10 / fase 2 do produto.
- Docker continua indisponível nesta máquina.

## Fase 7 — Usuários finais e checkout

### Feito
- **Usuários finais (AppUser)** em `/v1` com a chave secreta (escopo `app_users`):
  - `POST /v1/app-users` faz upsert e cria a carteira; o crédito grátis do projeto entra uma vez (`BONUS`, referência = id do usuário), exceto em `ORG_WALLET`;
  - `GET /v1/app-users/:externalId` e `POST /v1/app-users/:externalId/session-token`.
- **Session token** `fai_st_` + JWT HS256 (15 min, escopos `chat`, `checkout`, `balance`), assinado com `SESSION_TOKEN_SECRET`:
  - aceito em chat, models, balance, packages e checkout;
  - `Origin` precisa estar em `Project.allowedOrigins`;
  - a chave secreta com `Origin` (vazou para o navegador) é recusada com 403 `secret_key_in_browser`;
  - `/v1/usage` e as rotas de AppUser exigem a chave secreta.
- **Quem paga** (`resolveBilling`):
  - `ORG_WALLET` → organização;
  - `END_USER_WALLET` → usuário final (session token ou header `X-Fuse-User`); sem usuário → 400 `app_user_required`;
  - `HYBRID` → usuário final primeiro, organização se ele não tiver saldo.
  - O `UsageLog` guarda `appUserId`.
- **Checkout Pix do usuário final**:
  - `GET /v1/packages`, `POST /v1/checkout/pix` e `GET /v1/checkout/:checkoutId`;
  - pacotes do projeto, sem taxa;
  - CPF/CNPJ pedido na primeira compra (400 `document_required`) e guardado no AppUser, com cliente Asaas próprio;
  - `checkoutId` = `publicId` aleatório `chk_…`;
  - `Idempotency-Key`;
  - `returnUrl` validado (bloqueia `javascript:`, `data:`, `vbscript:`, `file:`, `blob:`).
  - O crédito vai para a carteira do usuário final pelo mesmo caminho único da Fase 6.
- **Checkout hospedado** `/pay/[checkoutId]` (web):
  - página pública mobile-first com QR, copia e cola, contagem e status a cada 3 s, e tela de sucesso;
  - `?return_url=` validado com `safeReturnUrl`;
  - `noindex` e `no-referrer`;
  - dados via `GET /public/checkout/:id` (30 req/min por IP).
- **Webhooks de saída** (`modules/webhooks-out`):
  - eventos `payment.received`, `app_user.credited`, `payment.expired` e `payment.refunded` são gravados na **mesma transação** do crédito, da expiração ou do estorno (outbox);
  - `balance.low` (1×/dia por projeto) e `usage.limit_reached` (1×/dia por chave) via Redis `SET NX`;
  - assinatura `X-Fuse-Signature: t=…,v1=hmac_sha256(secret, t + "." + corpo)`, mais `X-Fuse-Event` e `X-Fuse-Delivery`;
  - novas tentativas em 1 min, 5 min, 30 min, 2 h e 12 h (máximo de 6 tentativas), com lease contra envio duplo;
  - sem seguir redirects; em produção só https e IP público (anti-SSRF);
  - o segredo é gerado sozinho ao cadastrar a primeira URL.
- **Worker**: job `deliver-webhooks` a cada 30 s e logo após processar um webhook do Asaas.
- **CORS**: `/v1` aceita qualquer origem sem cookies (o gateway checa `allowedOrigins` por token); o resto aceita só o `APP_URL`, com cookies.
- **Painel**:
  - abas do projeto **Usuários finais** (busca, saldo, ajuste manual de bônus/remoção por dono e admin, com auditoria) e **Pacotes de créditos** (CRUD; pacote já vendido é desativado, não apagado);
  - **Webhooks** com histórico de entregas (status, tentativas, HTTP, corpo), reenvio e evento de teste.
- **`@fusai/sdk`** (TS, sem dependências; browser, Node 18+, React Native):
  - chat (com stream), models, balance, packages, `checkout.createPix/get/waitForPayment` e `appUsers`;
  - `FusaiError`;
  - token renovável (função) com **uma** busca compartilhada entre chamadas simultâneas;
  - `@fusai/sdk/server` com `verifyWebhook` (WebCrypto, tolerância de 5 min).
- **`@fusai/react`**: `<FusaiProvider>`, `<FusaiCheckout/>` (pacotes → CPF na 1ª vez → QR + copiar + contagem → sucesso, `onPaid`) e `<FusaiBalance/>`, com estilos inline em variáveis CSS `--fusai-*` (sem Tailwind).
- **`examples/next-pwa`** (porta 3001):
  - backend com `/api/session` (upsert + session token, chave secreta só no servidor) e `/api/webhooks/fuse` (verifica a assinatura e é idempotente);
  - front com saldo, `<FusaiCheckout/>`, chat em stream e lista de webhooks;
  - manifest e service worker mínimos (instalável).

### Como testar
```bash
docker compose up -d && pnpm db:migrate && pnpm db:seed
pnpm dev && pnpm --filter @fusai/api dev:worker
```
1. No painel, crie um projeto em **Cobrar do usuário final**. Em Configurações:
   - origem permitida `http://localhost:3001`;
   - webhook `http://localhost:3001/api/webhooks/fuse`.
   - Crie uma chave e um pacote (aba Pacotes de créditos).
2. `cp examples/next-pwa/.env.example examples/next-pwa/.env.local`. Preencha a chave e o segredo do webhook (Configurações → Revelar). Depois rode `pnpm --filter @fusai/example-next-pwa dev`.
3. Abra http://localhost:3001 → Pagar com Pix → CPF → pague no sandbox do Asaas (ou com o Asaas falso). O saldo sobe, os webhooks aparecem como verificados e o chat debita o saldo do usuário.

### Verificado
- `pnpm lint`, `pnpm typecheck` (8 pacotes) e `pnpm test` passando: 154 testes (38 shared, 7 SDK, 109 API).
- 12 testes novos de integração na API cobrem:
  - upsert com crédito grátis 1×;
  - session token com escopo, origem, assinatura e expiração;
  - chave secreta no navegador;
  - `X-Fuse-User`, `END_USER_WALLET` (402) e `HYBRID` (fallback para a organização);
  - compra completa com webhooks assinados (HMAC conferido);
  - backoff 1m/5m/… até `failed` e reenvio;
  - validações do checkout;
  - preflight CORS;
  - CRUD de pacotes, lista e ajuste de usuários.
- **Aceite no navegador**: 28/28 a 375px, com API, worker BullMQ, web, app de exemplo, Asaas falso e LLM falso reais.
  - Configuração feita só pela API do painel.
  - O app de exemplo cria o AppUser (R$ 0,50 grátis) e compra o pacote pelo `<FusaiCheckout/>`: pede o CPF, mostra QR, copiar e contagem.
  - O webhook do Asaas chega 3× e a tela vira "Pagamento confirmado". O saldo vai a R$ 10,50 (R$ 9 + R$ 1 de bônus + R$ 0,50).
  - `payment.received` e `app_user.credited` chegam ao app 1× cada, com assinatura verificada.
  - O chat em stream com session token debita a carteira do usuário final (R$ 10,48).
  - Checkout hospedado: pendente → pago sozinho; `return_url` com `javascript:` ignorado, deep link aceito; id inexistente → "não encontrado".
  - Abas do painel sem estouro horizontal; evento de teste entregue (HTTP 200).
- **Bugs achados no aceite e corrigidos**:
  - várias chamadas simultâneas pediam vários session tokens ao backend do app, criando usuários diferentes; o SDK agora compartilha uma única busca;
  - `GET /internal/projects/:id` não trazia `hasWebhookSecret` (desde a Fase 5), então Configurações sempre mostrava "Nenhum segredo gerado";
  - o Asaas falso reiniciava os ids (`pay_1`…) e colidia com cobranças antigas do banco de dev.

### Pendências
- Sandbox real do Asaas ainda não validado (igual à Fase 6).
- SSE `GET /v1/checkout/:id/events` (o PRD dá como alternativa ao polling): ficou só o polling de 3 s.
- `@fusai/sdk` e `@fusai/react` exportam TypeScript (padrão do monorepo); o build para publicar no npm fica para a Fase 10.
- Sem nota fiscal nem split: o valor das vendas aos usuários finais entra na conta Asaas da fusai (ver D-085).

## Fase 8 — MCP e Kit de Integração

### Feito
- **Servidor MCP remoto** em `POST /mcp` (`modules/mcp`), com `@modelcontextprotocol/sdk` 1.31:
  - Streamable HTTP stateless: um servidor e um transport por requisição, respostas JSON; `GET`/`DELETE` dão 405;
  - autenticação com a chave do projeto e escopo `mcp`; session token e chave sem o escopo são recusados; 401 traz `WWW-Authenticate`;
  - limite de 120 chamadas/min por chave;
  - as `instructions` dizem a qual projeto a conexão está ligada.
- **11 tools** do PRD §10.1:
  - `get_integration_guide` (guia personalizado; `stack` = `nextjs`, `react-native`, `flutter`, `node`, `python` ou `laravel`);
  - `get_project_config`, `list_models`, `get_balance` (organização ou `externalId`), `get_usage`;
  - `test_chat` (passa pelo gateway de verdade, com cobrança e log);
  - `list_packages` e `create_package` (valores em reais como texto, validados como no painel);
  - `update_project_settings` (só prévia sem `confirm: true`; gera o segredo do webhook);
  - `create_test_checkout` (só com chave `fai_test_` e Asaas em sandbox);
  - `send_test_webhook`.
  - Todas têm anotações MCP (`readOnlyHint`, `destructiveHint`…).
- **Recursos**: `fusai://docs/api`, `fusai://docs/sdk`, `fusai://docs/checkout` e `fusai://project` (o FUSAI.md). **Prompts**: `integrar_chat`, `integrar_compra_pix` e `migrar_de_openai`.
- **Auditoria**: toda chamada de tool ou leitura de recurso gera um `AuditLog` `mcp.<tool>` com a chave e a organização.
- **`@fusai/docs`** (pacote novo), fonte única das docs em Markdown (`content/NN-slug.md`):
  - um script gera `src/content.generated.ts`; um teste falha se ele estiver desatualizado;
  - as URLs da instalação são trocadas na renderização (`{{V1}}`, `{{MCP}}`…);
  - também gera o guia de integração, o `FUSAI.md`, o `llms.txt` e os snippets de MCP.
- **Docs públicas** em `/docs` com as 11 páginas do PRD §10.3:
  - Markdown renderizado no servidor com `marked`, headings com âncora, navegação lateral (menu recolhível no celular) e anterior/próxima;
  - cada página também em Markdown em `/docs/<slug>.md`;
  - `/llms.txt` (formato llmstxt.org) e `/llms-full.txt`.
- **Kit de Integração** (aba nova do projeto, `/app/projetos/[id]/integracao`):
  - comandos MCP para Claude Code, Cursor/Claude Desktop e VS Code;
  - `.env` pronto, botão **Baixar FUSAI.md** (gerado pela API com os dados atuais do projeto, sem a chave), prompt sugerido e exemplo de migração da OpenAI.
  - Ao **criar uma chave** (no painel e no onboarding), os comandos MCP já aparecem com a chave real.
- Refatoração: a lista de modelos e o resumo de consumo saíram de `gateway/routes.ts` para `gateway/queries.ts`, e são usados por `/v1` e pelo MCP.

### Como testar
```bash
pnpm dev && pnpm --filter @fusai/api dev:worker
# Painel → Projetos → (projeto) → Chaves de API → Nova chave: copie o comando MCP mostrado
claude mcp add --transport http fusai http://localhost:4000/mcp --header "Authorization: Bearer fai_live_..."
claude mcp list                                   # fusai ... ✔ Connected
npx @modelcontextprotocol/inspector --cli http://localhost:4000/mcp --transport http \
  --header "Authorization: Bearer fai_live_..." --method tools/list
# Docs: http://localhost:3000/docs · /llms.txt · /llms-full.txt · /docs/chat.md
pnpm --filter @fusai/docs generate               # depois de editar packages/docs/content/*.md
```

### Verificado
- `pnpm lint`, `pnpm typecheck` (9 pacotes), `pnpm test` e `pnpm build` passando: 166 testes (115 API, 38 shared, 7 SDK, 6 docs).
- 6 testes novos de MCP com o cliente oficial do SDK cobrem:
  - lista de tools, recursos e prompts;
  - 401, session token, chave sem escopo e 405;
  - guia personalizado por stack;
  - `test_chat` cobrado, `get_balance`, `get_usage` e auditoria;
  - `update_project_settings` (prévia → confirmação → webhook de teste entregue);
  - `create_package` e `create_test_checkout` (recusado com chave live, ok com chave de teste).
  - Também há teste do download do FUSAI.md, que não contém a chave.
- **Critérios de aceite do PRD**, contra a API real em dev:
  - `claude mcp add --transport http fusai http://localhost:4000/mcp --header "Authorization: Bearer …"` seguido de `claude mcp list` → **`fuseai: http://localhost:4000/mcp (HTTP) - ✔ Connected`** (entrada de teste removida depois);
  - **MCP Inspector** (CLI 2.7.0) `tools/list` → as **11 tools**; `--strict` sem avisos de portabilidade de schema;
  - `get_integration_guide` (stack `nextjs`) pelo Inspector → guia personalizado do projeto "App PWA": modo `END_USER_WALLET`, origem `http://localhost:3001`, webhook do app de exemplo, modelo com preço real e o pacote "100 mensagens".
- **Aceite no navegador**: 23/23 a 375px.
  - Kit: aba, os 3 clientes MCP, `.env`, prompt, migração da OpenAI e download do FUSAI.md (8 KB, com os dados do projeto e sem chave).
  - Criar chave mostra o comando MCP com a chave real, e essa chave conecta no MCP.
  - Docs: índice com 11 páginas, âncoras, código e tabelas sem estouro horizontal, navegação móvel e anterior/próxima.
  - `.md`, `llms.txt` e `llms-full.txt` sem placeholders; sem erros de JS.
- **Problemas achados e corrigidos**:
  - `webhookUrl` anulável virava `type: ["string","null"]` no JSON Schema, que vários clientes MCP rejeitam; agora é texto, e `""` remove;
  - o preço por milhão no guia usava `toFixed` (float) e escondia frações de centavo; agora é formatação exata;
  - um botão estourava a largura de 375px no Kit;
  - código inline em tabelas das docs quebrava no meio da palavra.

### Pendências
- OAuth 2.1 do MCP (descoberta padrão para clientes que exigem): fase 2 do produto, como o PRD prevê.
- A descrição de uma tool não substitui a confirmação do usuário: `update_project_settings` exige `confirm: true`, mas quem pede a confirmação é a IA cliente.
- `create_test_checkout` usa um CPF de sandbox fixo quando o usuário de teste não tem documento.

## Fase 10 (parte 1) — Painel super admin completo

- Dashboard de margem, conta do cliente (suspender, cobrança, limite, margem especial), chaves de API do cliente, usuários (bloquear, desconectar), entrar como cliente com auditoria, pacotes globais, uso, webhooks recebidos com reprocessamento, auditoria e sistema (D-119).
- **Testes:** API 139 (11 novos em `admin-panel.test.ts`), shared 42, sdk 7, docs 6.
- **Aceite no navegador:** 33/33 (1280px e 375px): liberar crédito, margem especial, suspender e reativar, pacote, bloquear (login recusado) e desbloquear, entrar como cliente e voltar, auditoria com todas as ações, sem rolagem horizontal em 9 páginas.

### Pendências
- Fase 10 (resto): e2e Playwright no CI, backup e README de deploy.
- Assinaturas recorrentes: aguardando definição.
