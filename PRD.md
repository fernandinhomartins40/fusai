# FuseAI — PRD e Instruções de Implementação

> **Produto:** FuseAI — Hub de IA multi-provedor com cobrança pré-paga por tokens
> **Domínio:** https://www.fuseai.com.br (web) · https://api.fuseai.com.br (API/gateway/MCP)
> **Versão do documento:** 1.0 — outubro/2026
> **Público deste documento:** a IA (Claude Code) que vai implementar o sistema, e o dono do produto.

---

## 0. Como a IA deve usar este documento

1. Este PRD é a **fonte da verdade**. Se algo não estiver aqui, escolha a opção mais simples e registre a decisão em `docs/DECISIONS.md`.
2. Implemente **por fases** (seção 15). Não comece uma fase sem a anterior passar nos critérios de aceite.
3. Ao final de cada fase: rode `pnpm lint`, `pnpm typecheck`, `pnpm test`, suba com `docker compose up` e confirme que funciona. Atualize `docs/PROGRESS.md`.
4. Nunca coloque chaves reais no código. Tudo via `.env` (há um `.env.example` completo na seção 13).
5. Código, nomes de tabelas, variáveis e commits em **inglês**. Textos de interface em **português do Brasil**.

---

## 1. Visão do produto

A FuseAI é um **gateway de IA** no estilo OpenRouter, voltado ao mercado brasileiro:

- O dono (super admin) cadastra suas chaves de API de provedores baratos (DeepSeek, Moonshot/Kimi, Zhipu/GLM, Alibaba/Qwen, MiniMax e OpenRouter como fallback).
- A FuseAI expõe **uma única API compatível com OpenAI** (`/v1/chat/completions`) e cobra o cliente **por token consumido**, com **margem configurável** sobre o custo real.
- Clientes compram **créditos pré-pagos via Pix** (Asaas), geram **chaves de API**, conectam a **IA de programação deles via MCP** para implementar a integração sozinha, e acompanham consumo num painel.
- Os **usuários finais** dos apps dos clientes (web, PWA ou nativo) também podem **comprar créditos de IA via Pix dentro do próprio app**, usando o SDK/checkout da FuseAI.
- O dono também usa a FuseAI para **as próprias aplicações** (organização interna, sem cobrança, só com rastreio de custo).

### 1.1 Modelo de receita

```
Preço de venda (R$/1M tokens) = custo do provedor (US$/1M) × câmbio USD→BRL × multiplicador de margem
```

Exemplo ilustrativo: um modelo que custa US$ 0,66 por 1M tokens de saída, com câmbio 5,50, custa ~R$ 3,63. Com multiplicador 4×, vende a ~R$ 14,52/1M. O admin pode também definir **preço fixo** por modelo (ignora o cálculo automático).

Diferente do OpenRouter (que repassa o preço sem markup e cobra uma taxa na compra de créditos), a FuseAI aplica **margem no token**. Opcionalmente o admin pode configurar também uma **taxa percentual na recarga** (desligada por padrão).

### 1.2 Personas

| Persona | O que faz |
|---|---|
| **Super Admin** (dono) | Cadastra provedores/chaves, modelos e preços, vê margem e receita, gerencia clientes, pacotes, pagamentos, saldo manual. |
| **Cliente (Organização)** | Empresa/dev para quem o dono cria apps. Cadastra-se, cria projetos, gera chaves, compra créditos, conecta MCP, vê consumo. |
| **Usuário final (AppUser)** | Usuário do app do cliente. Compra créditos via Pix dentro do app e consome IA. Não acessa o painel FuseAI. |
| **IA do cliente** (Claude Code, Cursor etc.) | Conecta no MCP da FuseAI com a chave do projeto e implementa a integração no app do cliente. |

---

## 2. Escopo

### 2.1 Dentro do escopo (MVP)

- Landing page de vendas + cadastro/login.
- Painel do cliente: organizações, projetos, chaves de API, carteira, compra de créditos via Pix, consumo, logs, Kit de Integração (MCP + instruções para IA), webhooks.
- Gateway OpenAI-compatível com streaming (SSE), roteamento por modelo, fallback entre provedores e cobrança por token.
- Carteiras de **organização** e de **usuário final**, com ledger imutável e reserva de saldo.
- Pix via Asaas (QR Code dinâmico + copia-e-cola + webhook).
- Checkout Pix embutível (SDK JS/React) e página de checkout hospedada (para PWA/WebView/app nativo).
- Servidor **MCP remoto** (Streamable HTTP) autenticado pela chave de API.
- Painel super admin completo.
- Docker (dev e prod), Turborepo, Postgres + Prisma.

### 2.2 Fora do escopo (fase 2+)

- Split de pagamento com o cliente (revenda/comissão via Asaas split) — deixar a modelagem pronta, não implementar.
- Cartão de crédito e boleto.
- Geração de imagem, áudio e embeddings (deixar o adapter preparado).
- Emissão de NFS-e automática.
- Lojas alternativas iOS / IAP Apple/Google.

---

## 3. Stack (decisão final)

| Camada | Tecnologia | Motivo |
|---|---|---|
| Monorepo | **Turborepo + pnpm workspaces** | Pedido do dono; cache de build, `turbo prune` para Docker. |
| Linguagem | **TypeScript** (strict) em tudo | Um só idioma de front a back. |
| Web | **Next.js 15 (App Router)** — landing, painel cliente, painel admin, checkout hospedado, docs | Um app web só, separado por route groups. |
| UI | **Tailwind CSS v4 + shadcn/ui + lucide-react + motion** | Design moderno, limpo, componentes prontos. |
| Gráficos | **Recharts** (via shadcn charts) | Simples. |
| Estado/dados (front) | **TanStack Query** + **react-hook-form** + **zod** | Padrão de mercado. |
| API | **Fastify 5** + **zod** (`fastify-type-provider-zod`) | Leve, rápido, ótimo para streaming SSE do gateway. |
| Auth (painéis) | **Better Auth** (email+senha, verificação de email, Google opcional) com adapter Prisma | Moderno, simples, self-hosted. |
| Banco | **PostgreSQL 16** + **Prisma 6** | Pedido do dono. |
| Cache / rate limit / filas | **Redis 7** + **BullMQ** | Rate limit por chave, entrega de webhooks com retry, jobs. |
| MCP | **@modelcontextprotocol/sdk** (TypeScript), transporte **Streamable HTTP** | Padrão atual para MCP remoto. |
| Pagamentos | **Asaas** (Pix) atrás de interface `PaymentProvider` | Permite trocar/adicionar Mercado Pago, Efí, Woovi depois. |
| Email | **Resend** (prod) / **Mailpit** (dev) via `nodemailer`-compatível | Simples. |
| Testes | **Vitest** (unit/integração) + **Playwright** (e2e mínimo) | |
| Lint/format | **Biome** | Um só tool, rápido. |
| Proxy/TLS (prod) | **Caddy** | HTTPS automático. |
| Infra | **Docker Compose** (dev e prod) | Isolado, pedido do dono. |

---

## 4. Estrutura do monorepo

```
fuseai/
├─ apps/
│  ├─ web/                    # Next.js 15
│  │  ├─ app/
│  │  │  ├─ (marketing)/      # landing: /, /precos, /modelos, /docs, /termos, /privacidade
│  │  │  ├─ (auth)/           # /entrar, /cadastro, /recuperar-senha, /verificar-email
│  │  │  ├─ (dashboard)/app/  # painel do cliente  -> /app/...
│  │  │  ├─ (admin)/admin/    # painel super admin -> /admin/...
│  │  │  ├─ pay/[checkoutId]/ # checkout Pix hospedado (público, mobile-first)
│  │  │  └─ llms.txt/route.ts # docs para IAs
│  │  └─ ...
│  └─ api/                    # Fastify
│     └─ src/
│        ├─ modules/
│        │  ├─ auth/          # Better Auth handler
│        │  ├─ gateway/       # /v1/chat/completions, /v1/models
│        │  ├─ billing/       # wallets, ledger, holds
│        │  ├─ payments/      # Pix, Asaas, webhooks
│        │  ├─ app-users/     # usuários finais + session tokens
│        │  ├─ mcp/           # servidor MCP
│        │  ├─ dashboard/     # rotas internas do painel cliente
│        │  ├─ admin/         # rotas internas do super admin
│        │  └─ webhooks-out/  # entrega de webhooks aos clientes
│        ├─ providers/        # adapters de LLM
│        ├─ lib/              # crypto, redis, errors, logger
│        └─ server.ts
├─ packages/
│  ├─ db/                     # Prisma schema, client, seed, migrations
│  ├─ shared/                 # schemas zod, tipos, constantes, utils de dinheiro
│  ├─ ui/                     # componentes shadcn compartilhados + tema
│  ├─ sdk/                    # @fuseai/sdk  (cliente TS: chat, saldo, checkout)
│  ├─ react/                  # @fuseai/react (<FuseCheckout/>, <FuseBalance/>)
│  └─ config/                 # tsconfig, biome, tailwind preset
├─ docker/
│  ├─ api.Dockerfile
│  ├─ web.Dockerfile
│  └─ Caddyfile
├─ docker-compose.yml         # dev: postgres, redis, mailpit (+ apps opcionais)
├─ docker-compose.prod.yml    # prod: caddy, web, api, worker, postgres, redis, migrate
├─ docs/  (DECISIONS.md, PROGRESS.md, API.md)
├─ CLAUDE.md
├─ turbo.json
└─ .env.example
```

O **worker** (BullMQ) roda a partir do mesmo código da `api` com outro entrypoint (`src/worker.ts`).

---

## 5. Conceitos centrais

### 5.1 Dinheiro e créditos

- Todo valor monetário interno é **inteiro em micro-reais** (`BigInt`): `1 BRL = 1_000_000 micros`. Nunca use `float` para dinheiro.
- Custos de provedor são guardados em **US$ por 1M tokens** como `Decimal(18,8)`.
- Na interface, o saldo é exibido como **“R$ 12,34 em créditos”**. Valores de pagamento Pix são em **centavos** (`Int`).
- Utilitários obrigatórios em `packages/shared/money.ts`: `brlToMicros`, `microsToBrl`, `centsToMicros`, `formatBRL`, `costForTokens(tokens, pricePerMMicros)` (arredonda **para cima** no micro).

### 5.2 Hierarquia

```
Organization (cliente)
 ├─ Membership (usuários do painel, papéis)
 ├─ Wallet (carteira da organização)
 └─ Project (um app do cliente)
     ├─ ApiKey (secret: fai_live_… / fai_test_…)
     ├─ CreditPackage (pacotes que o usuário final pode comprar)
     ├─ AppUser (usuário final do app)
     │   └─ Wallet (carteira do usuário final)
     └─ Webhook settings
```

### 5.3 Modos de cobrança do projeto (`Project.billingMode`)

| Modo | Quem paga o consumo | Uso típico |
|---|---|---|
| `ORG_WALLET` | Carteira da organização | O cliente paga a IA do app dele (B2B). |
| `END_USER_WALLET` | Carteira do AppUser identificado na requisição | O app vende créditos para os próprios usuários via Pix. |
| `HYBRID` | Tenta AppUser; se não houver saldo/AppUser, usa a org | Freemium: o cliente subsidia uma cota. |

### 5.4 Organização interna do dono

`Organization.billingType`:
- `PREPAID` (padrão): precisa de saldo.
- `POSTPAID`: pode ficar negativo até `creditLimitMicros` (para clientes de confiança).
- `INTERNAL`: sem cobrança; registra custo e preço “virtual” para relatórios. É a organização das apps do próprio dono.

---

## 6. Modelo de dados (Prisma)

Implemente em `packages/db/prisma/schema.prisma`. As tabelas do Better Auth (`user`, `session`, `account`, `verification`) devem ser geradas com o CLI do Better Auth e depois estendidas com o campo `role`.

```prisma
generator client { provider = "prisma-client-js" }
datasource db { provider = "postgresql"; url = env("DATABASE_URL") }

enum PlatformRole { USER SUPER_ADMIN }
enum OrgRole { OWNER ADMIN DEVELOPER BILLING }
enum OrgStatus { ACTIVE SUSPENDED }
enum BillingType { PREPAID POSTPAID INTERNAL }
enum BillingMode { ORG_WALLET END_USER_WALLET HYBRID }
enum KeyEnv { LIVE TEST }
enum WalletOwner { ORGANIZATION APP_USER }
enum LedgerType { PURCHASE USAGE REFUND ADJUSTMENT BONUS EXPIRATION }
enum PaymentStatus { PENDING CONFIRMED RECEIVED EXPIRED REFUNDED FAILED CANCELED }
enum PaymentProviderKind { ASAAS }
enum ProviderStatus { ACTIVE DISABLED }
enum PriceMode { AUTO FIXED }
enum UsageStatus { SUCCESS UPSTREAM_ERROR CLIENT_ERROR INSUFFICIENT_FUNDS RATE_LIMITED }

// ---- Better Auth (gerado) + extensão ----
model User {
  id            String        @id
  name          String
  email         String        @unique
  emailVerified Boolean       @default(false)
  image         String?
  role          PlatformRole  @default(USER)
  createdAt     DateTime      @default(now())
  updatedAt     DateTime      @updatedAt
  memberships   Membership[]
  sessions      Session[]
  accounts      Account[]
  @@map("user")
}
// Session, Account, Verification: conforme Better Auth CLI.

model Organization {
  id                String        @id @default(cuid())
  name              String
  slug              String        @unique
  document          String?       // CPF/CNPJ (necessário para Pix no Asaas)
  phone             String?
  status            OrgStatus     @default(ACTIVE)
  billingType       BillingType   @default(PREPAID)
  creditLimitMicros BigInt        @default(0)
  markupOverride    Decimal?      @db.Decimal(6,3) // margem especial deste cliente
  asaasCustomerId   String?
  asaasWalletId     String?       // fase 2: split
  createdAt         DateTime      @default(now())
  members           Membership[]
  projects          Project[]
  wallet            Wallet?
  payments          Payment[]
}

model Membership {
  id     String   @id @default(cuid())
  userId String
  orgId  String
  role   OrgRole  @default(OWNER)
  user   User         @relation(fields: [userId], references: [id], onDelete: Cascade)
  org    Organization @relation(fields: [orgId], references: [id], onDelete: Cascade)
  @@unique([userId, orgId])
}

model Project {
  id              String       @id @default(cuid())
  orgId           String
  name            String
  slug            String
  billingMode     BillingMode  @default(ORG_WALLET)
  defaultModelId  String?
  allowedModelIds String[]     // vazio = todos ativos
  allowedOrigins  String[]     // CORS para chamadas com session token no browser
  webhookUrl      String?
  webhookSecret   String?      // HMAC SHA-256
  freeCreditMicros BigInt      @default(0) // bônus ao criar AppUser (HYBRID/END_USER)
  createdAt       DateTime     @default(now())
  org             Organization @relation(fields: [orgId], references: [id], onDelete: Cascade)
  apiKeys         ApiKey[]
  appUsers        AppUser[]
  packages        CreditPackage[]
  @@unique([orgId, slug])
}

model ApiKey {
  id              String    @id @default(cuid())
  projectId       String
  name            String
  env             KeyEnv    @default(LIVE)
  prefix          String    // ex: "fai_live_ab12" (exibido no painel)
  hash            String    @unique // sha256(key + KEY_PEPPER)
  scopes          String[]  // "chat","billing:read","checkout","app_users","mcp"
  spendLimitMicros BigInt?  // limite mensal opcional
  rpmLimit        Int?      // requisições/min opcional
  lastUsedAt      DateTime?
  expiresAt       DateTime?
  revokedAt       DateTime?
  createdById     String
  createdAt       DateTime  @default(now())
  project         Project   @relation(fields: [projectId], references: [id], onDelete: Cascade)
}

model AppUser {
  id         String   @id @default(cuid())
  projectId  String
  externalId String   // id do usuário no sistema do cliente
  email      String?
  name       String?
  document   String?  // CPF (opcional, pode ser exigido pelo PSP)
  createdAt  DateTime @default(now())
  project    Project  @relation(fields: [projectId], references: [id], onDelete: Cascade)
  wallet     Wallet?
  @@unique([projectId, externalId])
}

model Wallet {
  id             String       @id @default(cuid())
  ownerType      WalletOwner
  orgId          String?      @unique
  appUserId      String?      @unique
  balanceMicros  BigInt       @default(0)
  reservedMicros BigInt       @default(0)
  updatedAt      DateTime     @updatedAt
  org            Organization? @relation(fields: [orgId], references: [id])
  appUser        AppUser?      @relation(fields: [appUserId], references: [id])
  entries        LedgerEntry[]
}

model LedgerEntry {
  id            String     @id @default(cuid())
  walletId      String
  type          LedgerType
  amountMicros  BigInt     // positivo = crédito, negativo = débito
  balanceAfter  BigInt
  referenceType String?    // "payment" | "usage" | "admin"
  referenceId   String?
  description   String?
  actorId       String?    // admin que fez ajuste
  createdAt     DateTime   @default(now())
  wallet        Wallet     @relation(fields: [walletId], references: [id])
  @@index([walletId, createdAt])
}

model CreditPackage {
  id           String   @id @default(cuid())
  projectId    String?  // null = pacote global (usado na recarga da organização)
  name         String
  priceCents   Int
  creditMicros BigInt
  bonusMicros  BigInt   @default(0)
  highlight    Boolean  @default(false)
  active       Boolean  @default(true)
  sortOrder    Int      @default(0)
  project      Project? @relation(fields: [projectId], references: [id], onDelete: Cascade)
}

model Payment {
  id                String              @id @default(cuid())
  walletId          String
  orgId             String
  projectId         String?
  appUserId         String?
  packageId         String?
  provider          PaymentProviderKind @default(ASAAS)
  providerPaymentId String?             @unique
  providerCustomerId String?
  status            PaymentStatus       @default(PENDING)
  amountCents       Int
  creditMicros      BigInt              // créditos + bônus a liberar
  pixCopyPaste      String?
  pixQrBase64       String?
  expiresAt         DateTime?
  paidAt            DateTime?
  creditedAt        DateTime?           // garante crédito único
  idempotencyKey    String              @unique
  metadata          Json?
  createdAt         DateTime            @default(now())
  org               Organization        @relation(fields: [orgId], references: [id])
  @@index([status, createdAt])
}

model InboundWebhookEvent {
  id          String   @id @default(cuid())
  provider    String
  eventKey    String   @unique // ex: `${event}:${payment.id}` ou id do evento
  type        String
  payload     Json
  processedAt DateTime?
  error       String?
  createdAt   DateTime @default(now())
}

model OutboundWebhook {
  id            String   @id @default(cuid())
  projectId     String
  event         String   // "payment.received","balance.low","app_user.credited"
  payload       Json
  status        String   @default("pending") // pending|delivered|failed
  attempts      Int      @default(0)
  lastError     String?
  nextAttemptAt DateTime @default(now())
  createdAt     DateTime @default(now())
  @@index([status, nextAttemptAt])
}

model Provider {
  id        String         @id @default(cuid())
  slug      String         @unique // deepseek | moonshot | zhipu | qwen | minimax | openrouter
  name      String
  baseUrl   String         // endpoint OpenAI-compatível
  apiKeyEnc String         // AES-256-GCM com ENCRYPTION_KEY
  status    ProviderStatus @default(ACTIVE)
  priority  Int            @default(100)
  timeoutMs Int            @default(120000)
  models    Model[]
}

model Model {
  id                    String     @id @default(cuid())
  slug                  String     @unique // nome público: "fuse/deepseek-chat"
  displayName           String
  description           String?
  providerId            String
  upstreamModel         String     // nome no provedor
  contextWindow         Int
  maxOutputTokens       Int        @default(8192)
  inputCostUsdPerM      Decimal    @db.Decimal(18,8)
  cachedInputCostUsdPerM Decimal?  @db.Decimal(18,8)
  outputCostUsdPerM     Decimal    @db.Decimal(18,8)
  priceMode             PriceMode  @default(AUTO)
  markupMultiplier      Decimal?   @db.Decimal(6,3) // null = usa padrão global
  inputPriceMicrosPerM  BigInt?    // usado quando FIXED (R$ em micros por 1M)
  outputPriceMicrosPerM BigInt?
  supportsTools         Boolean    @default(false)
  supportsVision        Boolean    @default(false)
  supportsReasoning     Boolean    @default(false)
  fallbackModelIds      String[]
  active                Boolean    @default(true)
  public                Boolean    @default(true) // aparece na landing
  sortOrder             Int        @default(0)
  provider              Provider   @relation(fields: [providerId], references: [id])
}

model UsageLog {
  id               String      @id @default(cuid())
  requestId        String      @unique
  orgId            String
  projectId        String
  apiKeyId         String?
  appUserId        String?
  walletId         String?
  modelId          String
  providerId       String
  promptTokens     Int         @default(0)
  cachedTokens     Int         @default(0)
  completionTokens Int         @default(0)
  reasoningTokens  Int         @default(0)
  costUsdMicros    BigInt      @default(0) // custo real em micro-dólares
  costBrlMicros    BigInt      @default(0) // custo convertido no câmbio do momento
  chargedMicros    BigInt      @default(0) // quanto foi cobrado
  latencyMs        Int?
  ttftMs           Int?
  stream           Boolean     @default(false)
  status           UsageStatus
  errorCode        String?
  createdAt        DateTime    @default(now())
  @@index([orgId, createdAt])
  @@index([projectId, createdAt])
  @@index([createdAt])
}

model Setting {
  key       String   @id // usd_brl_rate, default_markup, topup_fee_pct, min_topup_cents, low_balance_threshold_micros
  value     Json
  updatedAt DateTime @updatedAt
}

model AuditLog {
  id        String   @id @default(cuid())
  actorId   String?
  action    String   // "wallet.adjust","provider.update","org.suspend","impersonate.start"...
  target    String?
  metadata  Json?
  ip        String?
  createdAt DateTime @default(now())
  @@index([createdAt])
}
```

### 6.1 Seed (`packages/db/prisma/seed.ts`)

- Super admin a partir de `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`.
- Organização `FuseAI Interno` com `billingType = INTERNAL`.
- Settings: `usd_brl_rate = 5.50`, `default_markup = 4.0`, `topup_fee_pct = 0`, `min_topup_cents = 1000`, `low_balance_threshold_micros = 5_000_000`.
- Provedores (status `DISABLED` até o admin colar a chave): DeepSeek, Moonshot (Kimi), Zhipu/Z.ai (GLM), Alibaba Cloud Model Studio (Qwen), MiniMax, OpenRouter.
- Alguns modelos de exemplo com custos **marcados como “verificar”** no `description`. **Os preços dos provedores mudam com frequência; o admin deve conferir na página oficial de cada provedor antes de ativar.**
- Pacotes globais: R$ 20, R$ 50 (+5% bônus), R$ 100 (+10%), R$ 300 (+15%).

---

## 7. Gateway de IA

### 7.1 Endpoints públicos (`api.fuseai.com.br`)

Todos autenticados com `Authorization: Bearer fai_live_...` (ou session token de usuário final, ver 9.3).

| Método | Rota | Descrição |
|---|---|---|
| GET | `/v1/models` | Lista modelos ativos permitidos ao projeto, formato OpenAI + campo `pricing` em BRL. |
| POST | `/v1/chat/completions` | Compatível com OpenAI (messages, tools, stream, temperature, max_tokens, response_format...). |
| GET | `/v1/balance` | Saldo da carteira efetiva (org ou app user via header). |
| GET | `/v1/usage?from&to` | Consumo agregado do projeto. |

Header opcional `X-Fuse-User: <externalId>` identifica o usuário final quando a chamada vem do **backend** do cliente com a secret key (modos `END_USER_WALLET`/`HYBRID`).

Respostas de erro no formato OpenAI: `{ "error": { "message", "type", "code" } }`. Códigos próprios: `insufficient_funds` (402), `model_not_allowed` (403), `rate_limited` (429), `upstream_error` (502), `invalid_api_key` (401).

### 7.2 Adapter de provedores

Todos os provedores-alvo expõem API compatível com OpenAI; trocar provedor é basicamente mudar `baseUrl`, chave e nome do modelo. Implemente:

```ts
interface LlmProvider {
  chat(req: NormalizedChatRequest, signal: AbortSignal): Promise<NormalizedChatResponse>;
  chatStream(req: NormalizedChatRequest, signal: AbortSignal): AsyncIterable<NormalizedChunk>;
}
```

- Uma classe `OpenAICompatibleProvider` serve para todos. Subclasses só se algum provedor precisar de ajuste (ex.: campo de reasoning, nome de parâmetro).
- Em streaming, envie `stream_options: { include_usage: true }` ao upstream e leia `usage` do último chunk. Se o provedor não devolver usage, **estime** com contagem aproximada (`js-tiktoken` com `cl100k_base`) e marque `UsageLog.errorCode = "usage_estimated"`.
- Repasse o SSE ao cliente chunk a chunk, reescrevendo `model` para o slug público da FuseAI. Nunca exponha o nome do provedor nem a URL upstream nas respostas.
- Se o cliente desconectar, aborte o upstream (`AbortController`) e cobre os tokens já gerados.

### 7.3 Roteamento e fallback

1. Resolve o `Model` pelo slug; valida `active` e `allowedModelIds` do projeto.
2. Tenta o provedor do modelo. Em erro 429/5xx/timeout **antes do primeiro token**, tenta os `fallbackModelIds` em ordem.
3. Depois que o primeiro token foi enviado ao cliente, não há fallback (erro é repassado).
4. Circuit breaker simples em Redis: provedor com ≥5 falhas em 60s fica 30s em “aberto”.

### 7.4 Cobrança por requisição (reserva → liquidação)

Essencial para não deixar saldo negativo com requisições concorrentes.

1. **Estimar** custo máximo: `tokens_entrada_estimados × preço_entrada + min(max_tokens, model.maxOutputTokens, 4096 se ausente) × preço_saída`.
2. **Reservar** atomicamente:
   ```sql
   UPDATE "Wallet"
      SET "reservedMicros" = "reservedMicros" + $hold
    WHERE id = $walletId
      AND "balanceMicros" - "reservedMicros" + $creditLimit >= $hold
   RETURNING id;
   ```
   Sem linha retornada → 402 `insufficient_funds`.
3. Chamar o provedor.
4. **Liquidar** numa transação: `balance -= custo_real`, `reserved -= hold`, inserir `LedgerEntry(USAGE)` e `UsageLog`. Se falhou sem tokens → apenas libera a reserva, sem cobrança.
5. Organização `INTERNAL`: pula reserva e débito, mas grava `UsageLog` com `chargedMicros` virtual.
6. Job de limpeza (BullMQ, a cada 5 min): libera reservas órfãs (requisições que morreram) usando uma tabela/chave Redis `hold:{requestId}` com TTL.

### 7.5 Preço efetivo

```
precoPorM_micros =
  model.priceMode == FIXED ? model.inputPriceMicrosPerM
  : ceil(model.inputCostUsdPerM × usd_brl_rate × (org.markupOverride ?? model.markupMultiplier ?? default_markup) × 1_000_000)
```

Cache do preço em memória por 60s; invalida quando admin altera modelo/câmbio/margem.
Tokens em cache (cached input) usam `cachedInputCostUsdPerM` quando informado.

### 7.6 Rate limit

- Por chave: `rpmLimit` (padrão 120 rpm) com janela deslizante no Redis.
- Por IP para rotas públicas de checkout: 30/min.
- Limite de gasto mensal por chave (`spendLimitMicros`), verificado na reserva.

---

## 8. Chaves de API

- Formato: `fai_live_` ou `fai_test_` + 40 caracteres base62 aleatórios (`crypto.randomBytes`).
- Armazenar só `sha256(key + KEY_PEPPER)` e o `prefix` (primeiros 12 caracteres). **A chave completa aparece uma única vez** na criação, com botão copiar.
- Chaves `test`: só permitem modelos marcados como baratos e checkout Pix em **sandbox do Asaas**; consumo é cobrado normalmente da carteira (simples) — ou, se preferir, crie uma carteira de teste separada. Decisão MVP: **test usa sandbox de pagamento e a mesma carteira**; registre em DECISIONS.md.
- Escopos: `chat`, `billing:read`, `checkout`, `app_users`, `mcp`. Padrão ao criar: todos.
- Ações no painel: criar, renomear, definir limites, revogar, ver último uso.

---

## 9. Pagamentos Pix (Asaas)

### 9.1 Fluxo de recarga (organização ou usuário final)

1. Cliente escolhe pacote (ou valor livre ≥ `min_topup_cents` para a organização).
2. API cria/recupera o **customer** no Asaas (exige nome + CPF/CNPJ; peça no onboarding da org e, para AppUser, aceite via API/checkout).
3. Cria cobrança `billingType: "PIX"` (`POST /v3/payments`) com `externalReference = payment.id`.
4. Busca o QR Code (`GET /v3/payments/{id}/pixQrCode`) → recebe imagem base64, payload copia-e-cola e expiração. Salva em `Payment`.
5. Front mostra QR + copia-e-cola + contagem regressiva e faz **polling a cada 3s** (ou SSE `GET /v1/checkout/:id/events`).
6. Asaas envia webhook `PAYMENT_RECEIVED` (e `PAYMENT_CONFIRMED`). A API:
   - valida o header de token do webhook configurado no Asaas contra `ASAAS_WEBHOOK_TOKEN`;
   - grava `InboundWebhookEvent` com `eventKey` único (idempotência);
   - responde **200 imediatamente** e processa em fila;
   - numa transação: se `payment.creditedAt IS NULL`, credita a carteira (`LedgerEntry PURCHASE` + `BONUS` se houver), seta `status=RECEIVED`, `creditedAt=now()`.
7. Dispara `OutboundWebhook` `payment.received` para o projeto do cliente e email de confirmação.
8. `PAYMENT_REFUNDED` → débito `REFUND` (pode deixar saldo negativo; bloqueia uso até regularizar).
9. Job: marca `EXPIRED` cobranças pendentes vencidas.

Use `ASAAS_ENV=sandbox|production` para alternar a base URL. Confirme endpoints e nome do header do webhook na documentação oficial do Asaas no momento da implementação.

### 9.2 Interface de provedor de pagamento

```ts
interface PaymentProvider {
  ensureCustomer(input: { name: string; document: string; email?: string; externalRef: string }): Promise<string>;
  createPixCharge(input: { customerId: string; amountCents: number; description: string; externalRef: string; dueDate: Date }): Promise<{ providerPaymentId: string }>;
  getPixQrCode(providerPaymentId: string): Promise<{ copyPaste: string; qrBase64: string; expiresAt: Date }>;
  parseWebhook(headers: Record<string,string>, body: unknown): Promise<NormalizedPaymentEvent | null>;
  refund(providerPaymentId: string): Promise<void>;
}
```

Implementar `AsaasProvider`. Deixar pasta pronta para `MercadoPagoProvider`/`EfiProvider` no futuro.

### 9.3 Compra dentro do app do cliente (web, PWA, nativo)

**Regra de ouro:** a secret key (`fai_live_`) **nunca** vai para o front ou para o app. Para uso no cliente final existe o **session token**.

**Endpoints (chamados pelo backend do cliente com a secret key):**

| Método | Rota | Descrição |
|---|---|---|
| POST | `/v1/app-users` | Upsert `{ externalId, email?, name?, document? }` → cria carteira (+ `freeCreditMicros`). |
| GET | `/v1/app-users/:externalId` | Dados + saldo. |
| POST | `/v1/app-users/:externalId/session-token` | Retorna JWT curto (15 min, `fai_st_...`) com `projectId`, `appUserId`, escopos `chat`,`checkout`,`balance`. |
| GET | `/v1/packages` | Pacotes do projeto. |
| POST | `/v1/checkout/pix` | `{ externalId, packageId }` → `{ checkoutId, copyPaste, qrBase64, expiresAt, hostedUrl }`. |
| GET | `/v1/checkout/:checkoutId` | Status. |

**Com session token (front/app):** `POST /v1/chat/completions`, `GET /v1/balance`, `GET /v1/packages`, `POST /v1/checkout/pix` (sem `externalId`, deduzido do token). CORS liberado só para `Project.allowedOrigins`.

**Três formas de integrar, do mais simples ao mais customizado:**

1. **Checkout hospedado** — `https://www.fuseai.com.br/pay/{checkoutId}`: página mobile-first com QR, copia-e-cola, status ao vivo e tela de sucesso; aceita `?return_url=` (deep link ou URL). Funciona em **PWA, WebView e app nativo** (abrir no navegador/in-app browser).
2. **Componente React** — `@fuseai/react`: `<FuseCheckout sessionToken={...} packageId="..." onPaid={...} />` e `<FuseBalance />`. Funciona em Next/React e PWA.
3. **SDK/REST** — `@fuseai/sdk` (TS, roda em browser e React Native) ou REST puro para Flutter/Swift/Kotlin; o app desenha a própria UI de QR.

**Observação para apps nativos iOS/Android (incluir na doc e na landing, sem prometer o que não depende da FuseAI):** vender créditos digitais dentro de app de loja tem regras próprias. No Brasil, desde junho/2026 (iOS 26.5), a Apple passou a permitir meios de pagamento alternativos e links externos em apps da App Store após acordo com o CADE, com comissões próprias para essas modalidades. O Google Play tem política própria. O cliente é responsável por verificar as regras da loja dele; a FuseAI fornece o checkout hospedado e o SDK.

### 9.4 Webhooks de saída para o cliente

- Eventos: `payment.received`, `payment.expired`, `payment.refunded`, `app_user.credited`, `balance.low`, `usage.limit_reached`.
- Assinatura: header `X-Fuse-Signature: t=<timestamp>,v1=<hmac_sha256(secret, t + "." + body)>`.
- Retry com backoff exponencial (1m, 5m, 30m, 2h, 12h), máximo 6 tentativas. Tela de logs com reenvio manual.

---

## 10. MCP e “Kit de Integração para IA”

Objetivo: o cliente gera uma chave, cola um comando na IA de programação dele (Claude Code, Cursor, VS Code, etc.) e **a IA implementa sozinha** a integração no app.

### 10.1 Servidor MCP remoto

- Endpoint: `POST https://api.fuseai.com.br/mcp` — transporte **Streamable HTTP**, stateless (novo transport por requisição), usando `@modelcontextprotocol/sdk`.
- Auth: `Authorization: Bearer fai_live_...` com escopo `mcp`. (Fase 2: OAuth 2.1 conforme a especificação MCP, para clientes que exigem descoberta padrão.)
- **Tools:**

| Tool | Descrição |
|---|---|
| `get_integration_guide` | Retorna markdown **personalizado para o projeto**: base URL, modo de cobrança, modelos permitidos, exemplos em TS/Next, React Native, Flutter, Python, e o fluxo de checkout Pix. Parâmetro `stack` opcional (`nextjs`,`react-native`,`flutter`,`node`,`python`,`laravel`). |
| `get_project_config` | billingMode, allowedOrigins, webhookUrl, pacotes, modelo padrão. |
| `list_models` | Modelos permitidos + preço em R$/1M tokens. |
| `get_balance` | Saldo da organização (ou de um AppUser por `externalId`). |
| `get_usage` | Consumo por período/modelo. |
| `test_chat` | Faz uma chamada curta de teste (cobrada) para validar a integração. |
| `list_packages` / `create_package` | Gerencia pacotes de créditos do projeto. |
| `update_project_settings` | Altera allowedOrigins, webhookUrl, billingMode (com confirmação). |
| `create_test_checkout` | Gera checkout Pix em sandbox (somente chave `test`). |
| `send_test_webhook` | Dispara um evento de exemplo para o webhookUrl. |

- **Resources:** `fuseai://docs/api` (referência completa), `fuseai://docs/sdk`, `fuseai://docs/checkout`, `fuseai://project` (config atual).
- **Prompts:** `integrar_chat`, `integrar_compra_pix`, `migrar_de_openai`.
- Toda chamada MCP gera `AuditLog`.

### 10.2 Página “Kit de Integração” no painel (`/app/projetos/[id]/integracao`)

Ao gerar uma chave, a tela mostra, prontos para copiar:

1. **Comandos MCP**:
   - Claude Code: `claude mcp add --transport http fuseai https://api.fuseai.com.br/mcp --header "Authorization: Bearer <CHAVE>"`
   - JSON para Cursor / VS Code / Claude Desktop (bloco `mcpServers` com `type: "http"`/`streamable-http`, url e header).
2. **`.env` pronto**: `FUSEAI_API_KEY=...`, `FUSEAI_BASE_URL=https://api.fuseai.com.br/v1`.
3. **Botão “Baixar FUSEAI.md”**: arquivo de instruções para a IA do cliente colocar na raiz do projeto, gerado dinamicamente com os dados do projeto (sem a chave), contendo: regras (não expor secret key no front; usar session token), endpoints, exemplos, fluxo Pix, webhooks e checklist de testes.
4. **Prompt sugerido** para colar na IA: “Leia o FUSEAI.md e use o MCP fuseai para integrar chat com IA e compra de créditos via Pix neste projeto.”
5. Exemplo “migrar do OpenAI”: só trocar `baseURL` e `apiKey` no SDK oficial da OpenAI.

### 10.3 Docs públicas

- `/docs` no Next (MDX): Início rápido, Autenticação, Chat Completions, Modelos, Usuários finais e Session Token, Checkout Pix, Webhooks, MCP, SDKs, Erros, Limites.
- `/llms.txt` e `/llms-full.txt`: versão em texto das docs para IAs.

---

## 11. Painéis e telas

### 11.1 Design system

- **Dark-first** com modo claro; fonte **Geist** e **Geist Mono**; cantos `rounded-2xl`; bordas sutis; muito espaço em branco.
- Cor de marca “fuse”: gradiente **âmbar `#F59E0B` → rosa `#EC4899` → violeta `#8B5CF6`**, usado com parcimônia (logo, CTAs, destaques de gráfico).
- Fundo landing: grid sutil + glow radial do gradiente; seções com animações de entrada leves (`motion`, respeitar `prefers-reduced-motion`).
- Componentes: shadcn/ui (Button, Card, Dialog, Sheet, Table com TanStack Table, Tabs, Badge, Sonner para toasts, Command para busca).
- Logo: wordmark “fuse**ai**” com o “ai” em gradiente; ícone de dois traços se fundindo. Gere em SVG.
- Acessibilidade: contraste AA, foco visível, navegação por teclado. Mobile-first em tudo.

### 11.2 Landing (`/`)

Seções, nesta ordem:
1. **Header** fixo com blur: logo, Modelos, Preços, Docs, Entrar, botão “Começar grátis”.
2. **Hero**: título forte (ex.: “Uma API. Os melhores modelos de IA. Pague com Pix.”), subtítulo sobre economia com modelos de ponta a preço baixo, CTAs “Criar conta” e “Ver docs”, e um bloco de código animado mostrando `baseURL` trocado para FuseAI.
3. **Logos/modelos suportados** (texto/nome, sem usar logos de terceiros sem permissão).
4. **Como funciona** (3 passos): Crie a conta → Gere a chave e conecte o MCP → Sua IA integra e seus usuários pagam com Pix.
5. **Recursos**: API compatível com OpenAI, Pix instantâneo, créditos para usuários finais dentro do app, MCP para IA de programação, painel de consumo, fallback automático.
6. **Calculadora de preço** interativa: escolhe modelo, tokens/mês → estimativa em R$.
7. **Tabela de modelos** (dados reais de `/v1/models` públicos): nome, contexto, preço entrada/saída R$/1M.
8. **Para devs**: snippet curl/TS/Python em abas + comando MCP.
9. **FAQ** (Pix, créditos expiram?, privacidade/LGPD, onde os dados são processados, apps nativos).
10. **CTA final** + **footer** (termos, privacidade, contato, CNPJ).

SEO: metadata, Open Graph gerado (`opengraph-image.tsx`), `sitemap.ts`, `robots.ts`, JSON-LD de SoftwareApplication. Lighthouse ≥ 90.

### 11.3 Cadastro e onboarding

- Cadastro com nome, email, senha (Better Auth) + verificação de email.
- Onboarding em 3 passos: nome da empresa/organização + CPF/CNPJ + telefone → criar primeiro projeto (nome + modo de cobrança) → gerar primeira chave e mostrar Kit de Integração.
- Bônus de boas-vindas opcional configurável pelo admin (`welcome_bonus_micros`, padrão 0).

### 11.4 Painel do cliente (`/app`)

Sidebar: Visão geral · Projetos · Carteira · Consumo · Logs · Webhooks · Equipe · Configurações · Docs.

- **Visão geral**: saldo, gasto hoje/7d/30d, requisições, gráfico de consumo por dia e por modelo, alerta de saldo baixo, botão “Adicionar créditos”.
- **Projetos**: lista e criação. Dentro do projeto, abas: Visão geral · Chaves de API · Kit de Integração · Usuários finais (lista de AppUsers com saldo, busca, ajuste manual de bônus) · Pacotes de créditos (CRUD para venda aos usuários finais) · Modelos permitidos · Configurações (billingMode, allowedOrigins, webhook, crédito grátis inicial).
- **Carteira**: saldo, extrato (ledger) paginado e exportável CSV, botão de recarga → modal com pacotes ou valor livre → QR Pix + copia-e-cola + status ao vivo → confetti/sucesso. Histórico de pagamentos.
- **Consumo**: filtros por projeto/modelo/período, tabela e gráficos, export CSV.
- **Logs**: últimas requisições (modelo, tokens, custo, latência, status). **Não armazenar conteúdo das mensagens** por padrão (privacidade); opção futura de log de conteúdo opt-in.
- **Webhooks**: URL, segredo (revelar/rotacionar), eventos, histórico de entregas com reenvio.
- **Equipe**: convidar membros por email, papéis.
- **Configurações**: dados da organização, CPF/CNPJ, alerta de saldo baixo, recarga sugerida.

### 11.5 Painel super admin (`/admin`) — só `role = SUPER_ADMIN`

- **Dashboard**: receita (Pix recebido), consumo cobrado, **custo real de provedores**, **margem bruta (R$ e %)**, por dia/semana/mês; top clientes; top modelos; saldo total em carteiras (passivo); taxa de erro por provedor; requisições/min.
- **Clientes**: lista com busca/filtros; detalhe com projetos, membros, carteira, consumo, pagamentos; ações: **ajustar saldo** (com motivo obrigatório → ledger ADJUSTMENT + AuditLog), suspender/reativar, mudar billingType, margem especial, limite de crédito pós-pago, **entrar como cliente** (impersonate com banner e audit log).
- **Provedores**: CRUD, colar chave (mostrada mascarada, guardada criptografada), testar conexão (lista modelos do upstream), prioridade, status, timeout; saúde (latência, erros, circuit breaker).
- **Modelos**: CRUD; custo US$ entrada/saída/cache; modo de preço AUTO/FIXED; multiplicador; preço final calculado ao vivo em R$; fallbacks; capacidades; ativo/público; **simulador de margem**.
- **Preços globais**: câmbio USD→BRL (manual; opcional job diário buscando cotação), margem padrão, taxa de recarga, valor mínimo de recarga, bônus de boas-vindas.
- **Pacotes globais** de recarga.
- **Pagamentos**: todos os Pix com status, filtros, reprocessar webhook, estornar.
- **Uso**: explorador de UsageLog com filtros.
- **Webhooks recebidos**: eventos do Asaas, erros, reprocessar.
- **Auditoria**: AuditLog pesquisável.
- **Sistema**: status de Postgres/Redis/filas, versão.

---

## 12. Segurança, privacidade e compliance

- Senhas e sessões via Better Auth; cookies `httpOnly`, `secure`, `sameSite=lax`, domínio `.fuseai.com.br` em prod.
- Chaves de provedor criptografadas com **AES-256-GCM** (`ENCRYPTION_KEY` 32 bytes base64). Nunca retornadas ao front (só mascaradas).
- Chaves de cliente: só hash com pepper. Comparação em tempo constante.
- Validação zod em todas as entradas. Helmet/headers de segurança. CORS restrito.
- Webhooks de entrada: validação de token, idempotência, processamento assíncrono.
- Rate limit em login/cadastro (anti brute force) e em checkout.
- Toda ação administrativa → AuditLog.
- **LGPD**: termos de uso e política de privacidade (rascunho editável, marcar “revisar com advogado”), exclusão de conta, export de dados, minimização (não guardar prompts por padrão). A política deve informar que as requisições podem ser processadas por provedores de IA terceiros, inclusive fora do Brasil (ex.: China), e listar os provedores.
- **Termos dos provedores**: antes de ir a produção, o dono deve confirmar que os termos de cada provedor permitem revenda/uso por terceiros. Registrar no README.
- **Fiscal**: venda de créditos gera obrigação fiscal; deixar campo para emissão de nota (Asaas tem API de notas) como fase 2 e lembrar o dono de validar com contador.

---

## 13. Variáveis de ambiente (`.env.example`)

```env
# Geral
NODE_ENV=development
APP_URL=http://localhost:3000            # prod: https://www.fuseai.com.br
API_URL=http://localhost:4000            # prod: https://api.fuseai.com.br
COOKIE_DOMAIN=localhost                  # prod: .fuseai.com.br

# Banco / Redis
DATABASE_URL=postgresql://fuseai:fuseai@localhost:5432/fuseai
REDIS_URL=redis://localhost:6379

# Auth
BETTER_AUTH_SECRET=change-me-32-bytes
BETTER_AUTH_URL=http://localhost:4000
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=

# Segurança
ENCRYPTION_KEY=base64-32-bytes
KEY_PEPPER=change-me
SESSION_TOKEN_SECRET=change-me           # JWT dos session tokens de usuário final

# Asaas
ASAAS_ENV=sandbox                        # sandbox | production
ASAAS_API_KEY=
ASAAS_WEBHOOK_TOKEN=change-me

# Email
EMAIL_FROM="FuseAI <nao-responda@fuseai.com.br>"
RESEND_API_KEY=
SMTP_URL=smtp://localhost:1025           # Mailpit em dev

# Seed
SEED_ADMIN_EMAIL=admin@fuseai.com.br
SEED_ADMIN_PASSWORD=change-me-now
```

---

## 14. Docker

### 14.1 Dev (`docker-compose.yml`)

Serviços: `postgres:16-alpine` (volume nomeado, healthcheck), `redis:7-alpine`, `axllent/mailpit` (UI em :8025). Apps rodam no host com `pnpm dev` (hot reload rápido). Opcional: profile `full` que sobe `web` e `api` em container.

### 14.2 Prod (`docker-compose.prod.yml`)

- `caddy` (80/443, HTTPS automático): `www.fuseai.com.br` → web:3000; `fuseai.com.br` → redirect para www; `api.fuseai.com.br` → api:4000 (desabilitar buffering para SSE: `flush_interval -1`).
- `web` (Next standalone), `api`, `worker` (mesma imagem da api, comando `node dist/worker.js`), `migrate` (roda `prisma migrate deploy` e sai; `api` depende dele), `postgres`, `redis`.
- Dockerfiles multi-stage com `turbo prune --docker`, imagem final `node:22-alpine`, usuário não-root, `HEALTHCHECK` (`/health` na api, `/api/health` no web).
- Rede interna; só o Caddy expõe portas. Backup diário do Postgres (`pg_dump` em container cron, retenção 7 dias) documentado.

---

## 15. Plano de implementação por fases

Cada fase termina com critérios de aceite verificáveis. Commit ao final de cada fase.

### Fase 0 — Fundação
- Monorepo Turborepo + pnpm, `packages/config` (tsconfig, biome, tailwind preset), `apps/web`, `apps/api`, `packages/db|shared|ui`.
- Docker dev, `.env.example`, `CLAUDE.md`, `docs/`.
- **Aceite:** `docker compose up -d && pnpm i && pnpm dev` sobe web em :3000 e api em :4000 com `/health` OK; lint e typecheck passam.

### Fase 1 — Banco e autenticação
- Schema Prisma completo, migração inicial, seed.
- Better Auth na API, cliente no Next, páginas de entrar/cadastro/recuperar/verificar.
- Middleware de proteção `/app` e `/admin`; criação de organização + carteira no onboarding.
- **Aceite:** cadastrar, verificar email no Mailpit, logar, completar onboarding; admin do seed acessa `/admin`; usuário comum recebe 403 em `/admin`.

### Fase 2 — Provedores, modelos e preços (admin)
- CRUD de provedores (criptografia), modelos, settings; teste de conexão; cálculo de preço com testes unitários.
- **Aceite:** admin cadastra DeepSeek com chave, testa conexão, ativa um modelo e vê preço em R$ calculado corretamente (testes de `money.ts` e `pricing.ts` passando).

### Fase 3 — Billing core
- Wallet, ledger, reserva/liquidação, ajuste manual pelo admin.
- **Aceite:** teste de integração com 50 reservas concorrentes nunca deixa `balance - reserved` negativo (PREPAID); ledger soma igual ao saldo; ajuste do admin aparece no extrato e no AuditLog.

### Fase 4 — Chaves de API e gateway
- Criação/revogação de chaves; `/v1/models`, `/v1/chat/completions` (normal e stream), fallback, circuit breaker, rate limit, UsageLog.
- **Aceite:** o SDK oficial `openai` (Node) apontando para `http://localhost:4000/v1` com uma chave FuseAI funciona com e sem stream; saldo debitado = tokens × preço; sem saldo → 402; chave revogada → 401.

### Fase 5 — Painel do cliente
- Visão geral, projetos, chaves, carteira (extrato), consumo, logs, equipe, configurações.
- **Aceite:** fluxo completo pelo navegador, responsivo em 375px.

### Fase 6 — Pix (Asaas)
- `AsaasProvider`, recarga da organização, webhook idempotente, polling/SSE de status, emails, expiração, estorno.
- **Aceite (sandbox Asaas):** gerar Pix, simular pagamento no sandbox, crédito aparece uma única vez mesmo reenviando o webhook 3×.

### Fase 7 — Usuários finais e checkout no app
- AppUsers, session tokens, pacotes do projeto, `/v1/checkout/pix`, página `/pay/[id]`, `@fuseai/sdk`, `@fuseai/react`, webhooks de saída com HMAC e retry.
- **Aceite:** app de exemplo em `examples/next-pwa` (mínimo) cria AppUser, compra pacote via `<FuseCheckout/>` em sandbox, recebe webhook assinado e consome IA debitando a carteira do usuário final.

### Fase 8 — MCP e Kit de Integração
- Servidor MCP com tools/resources/prompts; página Kit de Integração; gerador do `FUSEAI.md`; docs MDX; `llms.txt`.
- **Aceite:** `claude mcp add ...` com chave local conecta; `get_integration_guide` retorna guia personalizado; MCP Inspector lista todas as tools.

### Fase 9 — Landing page
- Todas as seções da 11.2, calculadora, tabela de modelos ao vivo, SEO.
- **Aceite:** Lighthouse ≥ 90 (performance, acessibilidade, SEO) em mobile; visual consistente com o design system.

### Fase 10 — Admin completo e hardening
- Dashboard de margem, clientes, impersonate, pagamentos, auditoria, sistema.
- Testes e2e Playwright: cadastro → recarga (mock do PSP) → chave → chamada → extrato.
- Docker prod + Caddy + backup; README de deploy (VPS com Docker, DNS de `www` e `api`, configuração do webhook no Asaas).
- **Aceite:** `docker compose -f docker-compose.prod.yml up -d` sobe tudo com HTTPS em um servidor de teste; todos os testes passam.

---

## 16. Requisitos não funcionais

- Overhead do gateway (sem contar o provedor): p95 < 50 ms.
- Streaming: primeiro byte repassado em < 30 ms após o primeiro chunk do upstream.
- Disponibilidade alvo: 99,5%.
- Logs estruturados (pino) com `requestId` propagado; nunca logar chaves, tokens ou conteúdo de mensagens.
- Paginação por cursor em todas as listas grandes.
- Timezone de exibição `America/Sao_Paulo`; armazenamento em UTC.

---

## 17. Glossário

- **Créditos**: saldo pré-pago em R$ dentro da FuseAI.
- **Reserva (hold)**: valor bloqueado temporariamente durante uma requisição de IA.
- **AppUser**: usuário final do app de um cliente.
- **Session token**: JWT curto que permite ao front/app do cliente chamar a FuseAI em nome de um AppUser sem expor a secret key.
- **Margem/markup**: multiplicador aplicado sobre o custo do provedor convertido em reais.
