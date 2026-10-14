# FuseAI — guia para o Claude Code

**Consulte sempre o [PRD.md](PRD.md): ele é a fonte da verdade.** O que não estiver no PRD: escolha a opção mais simples e registre em [docs/DECISIONS.md](docs/DECISIONS.md). Trabalhamos por fases (PRD §15); progresso em [docs/PROGRESS.md](docs/PROGRESS.md).

## Visão
FuseAI (www.fuseai.com.br) é um gateway de IA multi-provedor, compatível com OpenAI, voltado ao Brasil.
O dono cadastra chaves de provedores baratos (DeepSeek, Kimi, GLM, Qwen, MiniMax, OpenRouter) e revende por token com margem.
Clientes compram créditos pré-pagos via Pix (Asaas), geram chaves de API e conectam a IA deles via MCP.
Usuários finais dos apps dos clientes também compram créditos via Pix (session token, checkout hospedado, SDK/React).
Há painel do cliente (`/app`), painel super admin (`/admin`) e landing de vendas.

## Comandos
```bash
docker compose up -d        # Postgres 16, Redis 7, Mailpit (UI http://localhost:8025)
pnpm i                      # instala e gera o Prisma Client
pnpm dev                    # web :3000 + api :4000 (turbo)
pnpm build                  # build de tudo
pnpm lint | pnpm lint:fix   # Biome
pnpm typecheck              # tsc em todos os pacotes
pnpm test                   # Vitest
pnpm db:migrate             # prisma migrate dev
pnpm db:seed                # seed (admin, provedores, settings, pacotes)
pnpm db:studio              # Prisma Studio
```
Filtrar um pacote: `pnpm --filter @fuseai/api <script>`.

## Convenções
- Código, tabelas, variáveis e commits em **inglês**; textos de UI em **pt-BR**. Commits convencionais (`feat: ...`).
- **Dinheiro**: inteiro em micro-reais `BigInt` (1 BRL = 1_000_000). Pagamentos Pix em centavos `Int`. **Nunca float para dinheiro.** Cobrança sempre arredonda **para cima**. Use `@fuseai/shared/money`.
- Saldo: padrão reserva → liquidação (PRD §7.4) com `UPDATE ... WHERE balance - reserved + limit >= hold`.
- Segurança: nenhuma chave real no código; chaves de cliente só como `sha256(key + KEY_PEPPER)`; chaves de provedor em AES-256-GCM; secret key nunca no front; webhooks idempotentes; zod em toda entrada; nunca logar segredos nem conteúdo de mensagens.
- UI: componentes e tokens de `@fuseai/ui` (dark-first, Geist, gradiente âmbar → rosa → violeta com parcimônia), mobile-first, acessível.
- Arquivos pequenos e coesos por módulo; poucas dependências; sem abstrações desnecessárias.
- Pacotes internos exportam código TypeScript (sem build): Next usa `transpilePackages`, a API empacota com tsup.

## Estrutura
```
apps/web        Next.js 15 (App Router): (marketing), (auth), (dashboard)/app, (admin)/admin, pay/[id]
apps/api        Fastify 5: src/modules/<módulo>, src/providers, src/lib, server.ts (worker.ts depois)
packages/config tsconfigs compartilhados
packages/shared schemas zod, tipos, utilitários de dinheiro
packages/ui     tema (tokens CSS Tailwind v4), logo, componentes base shadcn-style
packages/db     Prisma schema, client, seed, migrations
docs/           DECISIONS.md, PROGRESS.md, API.md
```
