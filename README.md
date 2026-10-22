# fusai

**fusai** ([www.fusai.com.br](https://www.fusai.com.br)) é um gateway de IA multi-provedor, compatível com a API da OpenAI e feito para o Brasil.

- **Como a fusai ganha:** o dono cadastra chaves de provedores baratos (DeepSeek, Kimi, GLM, Qwen, MiniMax e OpenRouter como reserva) e revende o uso por token, com margem.
- **Clientes:** compram créditos pré-pagos via **Pix** (Asaas), geram chaves de API e conectam a IA de programação deles via **MCP** para fazer a integração.
- **Usuários finais** dos apps dos clientes: também compram créditos via Pix, por session token, checkout hospedado ou os componentes `@fusai/sdk` e `@fusai/react`.

O produto tem três áreas: o painel do cliente (`/app`), o painel do super admin (`/admin`) e a landing pública com a documentação (`/docs`).

A fonte da verdade do produto é o [PRD.md](PRD.md). As decisões ficam em [docs/DECISIONS.md](docs/DECISIONS.md) e o andamento em [docs/PROGRESS.md](docs/PROGRESS.md).

## Stack

| Camada | Tecnologia |
|---|---|
| Web | Next.js 15 (App Router), Tailwind CSS v4, componentes de `@fusai/ui` |
| API | Fastify 5, Better Auth, zod, Prisma |
| Dados | PostgreSQL 16 e Redis 7 (BullMQ, rate limit) |
| Integrações | Asaas (Pix), VeloMail (e-mail), provedores de IA compatíveis com OpenAI |
| Monorepo | pnpm 10, Turborepo, Biome, Vitest, Playwright |

Dinheiro é sempre inteiro: saldo em micro-reais `BigInt` (1 BRL = 1.000.000) e Pix em centavos. A cobrança arredonda para cima.

## Estrutura

```
apps/web         Next.js: landing, /docs, /app (cliente), /admin, /pay/[id] (checkout hospedado)
apps/api         Fastify: gateway /v1, painel /internal, webhooks, MCP; worker BullMQ em src/worker.ts
packages/shared  schemas zod, tipos e utilitários de dinheiro
packages/ui      tema e componentes base
packages/db      schema Prisma, migrations e seed
packages/sdk     @fusai/sdk: cliente TypeScript (chat, saldo, checkout Pix, verifyWebhook)
packages/react   @fusai/react: <FusaiCheckout/>, <FusaiBalance/>, <FusaiTopup/>
packages/docs    documentação em Markdown, FUSAI.md e llms.txt
examples/next-pwa  app de exemplo com session token, checkout e webhooks (porta 3001)
e2e              testes de ponta a ponta com Playwright
deploy           Docker Compose da VPS, nginx, scripts de deploy e backup
docs             decisões, progresso, API, operação e auditoria (docs/pie)
```

## Rodar localmente

Pré-requisitos: Node 22 ou mais recente, pnpm 10 e Docker.

```bash
cp .env.example .env        # preencha os valores (há instruções no próprio arquivo)
docker compose up -d        # Postgres 16, Redis 7 e Mailpit (UI em http://localhost:8025)
pnpm i                      # instala e gera o Prisma Client
pnpm db:migrate             # aplica as migrations
pnpm db:seed                # admin, provedores, configurações e pacotes
pnpm dev                    # web em :3000 e API em :4000
pnpm --filter @fusai/api dev:worker   # worker: webhooks Pix, expiração, e-mails, reservas órfãs
```

Em desenvolvimento os e-mails vão para o Mailpit. Pagamentos usam o sandbox do Asaas quando a chave é `$aact_hmlg_...`.

Outros comandos úteis:

```bash
pnpm build                  # build de tudo
pnpm lint | pnpm lint:fix   # Biome
pnpm typecheck              # tsc em todos os pacotes
pnpm db:studio              # Prisma Studio
pnpm --filter @fusai/docs generate   # depois de editar packages/docs/content/*.md
```

Para rodar um comando em um pacote só: `pnpm --filter @fusai/api <script>`.

## Testes

```bash
pnpm test        # Vitest em todos os pacotes
pnpm test:e2e    # Playwright (veja e2e/README.md)
```

- A suíte da API usa um Postgres real, no banco `<DATABASE_URL>_test` ou em `TEST_DATABASE_URL`, e o Redis. O banco de teste precisa ser **UTF-8**.
- Asaas, provedores de IA e VeloMail são substituídos por servidores falsos (`apps/api/test/fake-*.ts`). Nenhum teste faz cobrança real nem envia e-mail de verdade.

## Deploy

Produção roda em uma VPS com Docker, atrás do nginx do host (TLS via certbot). Um contêiner `fuseai-nginx` roteia pelo nome do host: `api.fusai.com.br` vai para a API, e `www` e o domínio raiz vão para a web.

- **O deploy acontece só pelo GitHub Actions:** um push na `main` roda validação, lint, typecheck e testes, gera as imagens no GHCR e executa o `deploy/deploy.sh` na VPS. Não se altera a VPS à mão.
- **Rollback:** se a nova versão não ficar saudável, o deploy volta para a anterior. Também há o workflow manual "Rollback".
- **Backup:** diário (`pg_dump`), guardado por 7 dias e com teste automático de restauração.
- **Segredos:** ficam nos secrets do GitHub e no `.env` da VPS, nunca no repositório. Em produção, `BETTER_AUTH_SECRET` e `SESSION_TOKEN_SECRET` precisam de 32 ou mais caracteres. Gere com `openssl rand -hex 32`.
- **Primeira instalação:**
  - **DNS:** registros A para `www` e `api` apontando para a VPS.
  - **Host:** workflow `setup-host`.
  - **Asaas:** o webhook é criado ou atualizado sozinho depois de cada deploy saudável (`deploy/asaas-webhook.mjs`).

Os detalhes de operação (limites dos contêineres, healthchecks, rollback e restauração do backup) estão em [docs/OPERACAO.md](docs/OPERACAO.md).

## Termos dos provedores de IA

**Antes de vender em produção, confirme que os termos de uso de cada provedor cadastrado permitem revenda e uso por terceiros.** Isso vale para DeepSeek, Moonshot/Kimi, Zhipu/GLM, Alibaba/Qwen, MiniMax, OpenRouter e qualquer outro. Os termos mudam; reveja periodicamente.

A política de privacidade informa aos clientes que as requisições podem ser processadas por provedores de IA terceiros, inclusive fora do Brasil.

Os preços dos provedores também mudam com frequência. Confira o custo na página oficial de cada um antes de ativar um modelo.

## Pacotes publicáveis

`@fusai/sdk` e `@fusai/react` podem ser publicados no npm:

```bash
pnpm --filter @fusai/sdk publish --access public
pnpm --filter @fusai/react publish --access public
```

O `prepublishOnly` gera o `dist/` (ESM, CJS e tipos) com tsup, e o `publishConfig` aponta os `exports` para lá. Dentro do monorepo os pacotes continuam sendo consumidos direto do `src/`.
