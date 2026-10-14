# Progresso

| Fase | Status |
|---|---|
| 0 — Fundação | ✅ concluída (ver pendências) |
| 1 — Banco e autenticação | ✅ concluída (ver pendências) |
| 2 — Provedores, modelos e preços | ⏳ |
| 3 — Billing core | ⏳ |
| 4 — Chaves de API e gateway | ⏳ |
| 5 — Painel do cliente | ⏳ |
| 6 — Pix (Asaas) | ⏳ |
| 7 — Usuários finais e checkout | ⏳ |
| 8 — MCP e Kit de Integração | ⏳ |
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
- **Seed idempotente** (`pnpm db:seed`): super admin (`SEED_ADMIN_EMAIL`/`SEED_ADMIN_PASSWORD`, email já verificado); org `FuseAI Interno` (`INTERNAL`, carteira, admin como OWNER); settings (câmbio 5,50, margem 4,0, taxa 0, mínimo R$ 10, alerta R$ 5, bônus 0); 6 provedores `DISABLED` sem chave; 6 modelos de exemplo **inativos** com preço “verificar”; 4 pacotes globais (R$ 20, 50 +5%, 100 +10%, 300 +15%). Rodar de novo não sobrescreve alterações do admin.
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
# 5. saia e entre como admin@fuseai.com.br / change-me-now -> /admin mostra os contadores
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
