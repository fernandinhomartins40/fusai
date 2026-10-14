# Progresso

| Fase | Status |
|---|---|
| 0 — Fundação | ✅ concluída (ver pendências) |
| 1 — Banco e autenticação | ⏳ |
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
