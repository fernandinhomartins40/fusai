# Decisões

Registro das decisões tomadas onde o PRD não especifica (ou onde algo divergiu). Mais recente no fim.

## Fase 0

- **D-001 — Pacotes internos sem build.** `@fuseai/shared`, `@fuseai/ui` e `@fuseai/db` exportam o código-fonte TypeScript. O Next compila via `transpilePackages`; a API é empacotada com **tsup** (`noExternal: [/^@fuseai\//]`). Evita uma etapa de build por pacote e mantém o hot reload simples.
- **D-002 — Biome na raiz.** Um único `biome.json` na raiz em vez de um preset em `packages/config` (o Biome procura a config subindo diretórios; um arquivo basta). `packages/config` contém só os tsconfigs.
- **D-003 — "Tailwind preset" = CSS.** No Tailwind v4 o tema é definido em CSS (`@theme`). O preset é o arquivo `@fuseai/ui/styles.css` (tokens, variantes `dark`, utilitários `bg-fuse-gradient`, `text-fuse-gradient`, `bg-grid`), importado pelo app web.
- **D-004 — Tema dark-first via classe.** `next-themes` com `attribute="class"`, `defaultTheme="dark"` e sem seguir o sistema; o usuário alterna para o claro manualmente. `:root` guarda o tema claro e `.dark` o escuro (padrão shadcn).
- **D-005 — Versões fixadas.** Next 15.5 (PRD pede 15), React 19.2, Tailwind 4.3, Fastify 5.12, Prisma 6.19, TypeScript 5.9 (o TS 7 nativo ainda não é suportado por todo o ecossistema), Vitest 3.2, Biome 2.5, Turbo 2.11, zod 4.
- **D-006 — `.env` único na raiz.** A API carrega com `node --env-file-if-exists=../../.env` (via tsx). Variáveis validadas com zod em `apps/api/src/lib/env.ts`, que cresce a cada fase.
- **D-007 — Request id.** A API aceita `X-Request-Id` de entrada (≤ 64 caracteres) ou gera UUID, e devolve no header `x-request-id`. Logs pino com `redact` para `authorization`, `cookie` e headers de webhook.
- **D-008 — `formatBRL` arredonda para exibição.** Exibição arredonda meio-para-cima no centavo; cobrança usa sempre `costForTokens`/`microsToCentsCeil` (para cima). Modo `precise` mostra frações abaixo do centavo (útil para preço por token).
