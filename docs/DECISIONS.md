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

## Fase 1

- **D-009 — Tabelas do Better Auth escritas à mão.** Em vez do CLI, o schema Prisma replica as tabelas core do Better Auth 1.7 (conferidas em `@better-auth/core/dist/db/get-tables`). `role` é um `additionalField` com `input: false`, então o cliente nunca consegue defini-lo (há teste).
- **D-010 — Sessão por cookie direto na API.** O navegador chama `api` com `credentials: 'include'`; CORS só para `APP_URL`. Em dev os cookies de `localhost` valem para :3000 e :4000; em prod, `crossSubDomainCookies` com `COOKIE_DOMAIN=.fuseai.com.br`. Rotas do painel ficam em `/internal/*` e exigem sessão.
- **D-011 — CSRF por checagem de `Origin`.** Além de `sameSite=lax` e corpo JSON, toda requisição não-GET em `/internal/*` com `Origin` diferente de `APP_URL` recebe 403.
- **D-012 — Proteção em duas camadas no Next.** O middleware só confere a presença do cookie de sessão (rápido, sem chamar a API); os layouts de `/app` e `/admin` validam a sessão de verdade via `GET /internal/me` e o papel. Não-admin recebe `forbidden()` (status 403, flag `experimental.authInterrupts`). A API também valida o papel em cada rota admin.
- **D-013 — `.env` da raiz no Next.** `next.config.ts` carrega o `.env` da raiz e expõe `NEXT_PUBLIC_API_URL`/`NEXT_PUBLIC_APP_URL` derivados de `API_URL`/`APP_URL`. `INTERNAL_API_URL` (opcional) é a URL que o servidor Next usa para falar com a API (útil na rede do Docker).
- **D-014 — Emails via SMTP para tudo.** Um único cliente `nodemailer`: Mailpit em dev (`SMTP_URL`) e o relay SMTP do Resend em prod (`RESEND_API_KEY`). Evita SDK extra.
- **D-015 — Onboarding.** Organização (nome, CPF/CNPJ com dígito verificador, telefone) → projeto (nome + `billingMode`) → tela final. A etapa de chave/Kit entra quando as chaves existirem (Fase 4). Bônus de boas-vindas (`welcome_bonus_micros`) vira `LedgerEntry BONUS` na criação da carteira. Slugs únicos com sufixo aleatório em caso de colisão.
- **D-016 — Modelos do seed inativos.** Além dos provedores `DISABLED`, os modelos de exemplo entram com `active=false`; o admin ativa depois de conferir o preço oficial.
- **D-017 — Testes de integração com banco real.** A API testa contra `TEST_DATABASE_URL` ou `<DATABASE_URL>_test`; o global setup roda `prisma migrate deploy` (cria o banco se faltar) e cada teste trunca as tabelas. Por isso `pnpm test` precisa do Postgres no ar.
- **D-018 — Turbo repassa as variáveis do projeto.** O modo estrito do Turbo removia variáveis do shell (ex.: `DATABASE_URL`); elas foram listadas em `globalPassThroughEnv`.
- **D-019 — `output: 'standalone'` só fora do Windows.** No Windows a cópia standalone exige symlinks (Modo de Desenvolvedor). A imagem de produção é construída em Linux, onde fica sempre ligada.
- **D-020 — Rate limit de auth em memória por ora.** Better Auth com regras próprias (login/cadastro 5/min; reset/reenvio 3 a cada 5 min), IP vindo do `req.ip` do Fastify (com `trustProxy`, atrás do Caddy). Migra para Redis na Fase 4.

## Fase 2

- **D-021 — Decimal exato em BigInt.** Preços usam `mulDecimalsCeil` sobre strings decimais (custo 8 casas, câmbio 6, margem 3), sem float nem biblioteca. Prisma `Decimal` é convertido com `.toFixed()` (nunca `.toString()`, que pode gerar notação exponencial).
- **D-022 — Cache de tokens no modo FIXED.** Não existe preço fixo separado para entrada em cache; usa o preço fixo de entrada.
- **D-023 — Settings como strings JSON.** Valores decimais e micros ficam como string no `Setting.value` (BigInt-safe); `settingsSchema` valida e normaliza vírgula para ponto. Cache de 60 s é por instância da API (`createSettingsStore`); com várias réplicas a mudança propaga em até 60 s.
- **D-024 — Schemas de modelo sem defaults no zod.** No zod 4, `.partial()` ainda aplica `.default()`, o que faria um PATCH resetar campos omitidos. A API aplica os defaults de criação e valida o preço fixo no registro mesclado (há teste de regressão).
- **D-025 — Guardas de sessão em `onRequest`.** Rodam antes do parse/validação do corpo, então quem não tem permissão recebe 401/403, nunca 400 com detalhes de validação.
- **D-026 — Teste de conexão = `GET /models`.** Barato (não gasta tokens) e padrão OpenAI. A chave é removida de qualquer mensagem de erro do upstream antes de responder.
- **D-027 — `ENCRYPTION_KEY` obrigatório.** A API não sobe sem uma chave de 32 bytes em base64. O `.env.example` traz o campo vazio com o comando para gerar. Trocar a chave invalida as chaves de provedor salvas (o admin vê "erro" e recadastra).
- **D-028 — Formulários admin sem TanStack Query.** Páginas do admin são server components que leem a API; formulários client chamam a API e fazem `router.refresh()`. TanStack Query entra quando houver dados ao vivo/polling (Fases 5–6).
- **D-029 — Corpo JSON vazio é aceito.** Parser JSON próprio (via `secure-json-parse`, o mesmo do Fastify) trata corpo vazio como ausente; JSON malformado ou com `__proto__`/`constructor` → 400.

## Fase 3

- **D-030 — Reservas em tabela (`WalletHold`), não em Redis.** O PRD aceita "tabela/chave Redis". Na tabela, a reserva e a hold entram na mesma transação, sem estado divergente entre Redis e Postgres. A limpeza é uma única instrução SQL. TTL de 15 min (acima do timeout máximo de upstream).
- **D-031 — Worker com `setInterval` até haver Redis.** `src/worker.ts` roda a limpeza a cada 5 min. Vira job repetível do BullMQ na Fase 4. Rodar dois workers é seguro: a instrução é atômica.
- **D-032 — Idempotência no banco.** `UNIQUE(type, referenceType, referenceId)` no ledger: um `USAGE` por request e um `PURCHASE`/`BONUS`/`REFUND` por pagamento. Lançamentos sem referência (ajustes manuais) não colidem, porque NULL é distinto no Postgres.
- **D-033 — Cobrança real pode passar da hold.** `settle` debita o custo real mesmo se ultrapassar a estimativa (raro, a estimativa é o máximo). Em PREPAID isso pode deixar o disponível levemente negativo, e a próxima reserva é recusada até recarga.
- **D-034 — Hold zero também checa saldo.** Carteira com disponível negativo (ex.: estorno) não faz nenhuma requisição, nem as gratuitas, até regularizar (PRD §9.1 item 8).
- **D-035 — Datas em UTC no SQL cru.** O Prisma grava `DateTime` como UTC em colunas `timestamp` sem fuso. No SQL cru usamos `now() AT TIME ZONE 'UTC'` e convertemos parâmetros com `::timestamptz AT TIME ZONE 'UTC'`. Sem isso, um Postgres fora de UTC desloca horários (bug pego em teste).
- **D-036 — Banco em UTF-8.** O `docker-compose` fixa `--encoding=UTF8`. Um cluster com codificação do Windows (WIN1252) rejeita parte dos caracteres Unicode.
- **D-037 — Ajuste manual limitado a R$ 1.000.000 por lançamento** e com motivo obrigatório (5–300 caracteres). Ajuste pode deixar saldo negativo (poder do admin, fica auditado).
- **D-038 — Extrato visível a qualquer membro da organização**, inclusive DEVELOPER. Restrições por papel para ações financeiras ficam para quando houver ações (recarga, Fase 6).

## Fase 4

- **D-039 — ID de cobrança próprio.** Cada chamada do gateway usa um UUID gerado no servidor (`x-fuse-request-id`) para hold, ledger e `UsageLog`. O `X-Request-Id` do cliente fica só para correlação de logs: se fosse a chave de cobrança, repetir o header causaria colisão.
- **D-040 — Chaves de teste limitadas por preço.** O schema não tem uma flag de "modelo barato". A regra é: preço de saída ≤ `test_key_max_output_micros` (configurável, padrão R$ 50/1M), aplicada em `/v1/models` e no chat. A chave de teste usa a mesma carteira (PRD §8).
- **D-041 — Reserva = pior caso entre os candidatos.** Com fallback, um modelo mais caro pode atender; então a hold é o máximo entre o modelo pedido e os fallbacks. A cobrança usa o preço do modelo que realmente atendeu, e o `model` da resposta é o slug dele.
- **D-042 — Estimativa de prompt para a reserva sem tokenizer.** `tamanho do JSON / 3 + 16` superestima e é barato no caminho quente. O tokenizer (`js-tiktoken cl100k_base`) só roda quando o provedor não informa usage.
- **D-043 — O que é "retentável".** Só 400/413/422 do upstream são erro do pedido do cliente (repassados como 400, sem fallback). 401/402/403/404 indicam problema da nossa configuração no provedor; esses, mais 408/409/429/5xx/timeout/rede, disparam fallback e contam para o circuit breaker.
- **D-044 — Circuit breaker e rate limit "fail-open".** Se o Redis cair, deixam passar (com log) em vez de derrubar o gateway. Se todos os provedores estiverem abertos, o primário é tentado mesmo assim, como sonda.
- **D-045 — Desconexão do cliente.** Com stream, cobra prompt + tokens gerados (usage do provedor quando houver, senão estimativa). Sem stream, cobra o prompt estimado (o provedor já o processou). Fica `UsageLog.status = CLIENT_ERROR` e `errorCode = client_disconnected`.
- **D-046 — Liquidação antes do `[DONE]`.** O débito é gravado antes de encerrar o stream, para quem lê o saldo logo depois ver o valor certo. Custa alguns ms no fim da resposta.
- **D-047 — Respostas sem rastro do provedor.** O `id` vira `chatcmpl-<uuid>`, o `model` vira o slug público, campos extras (ex.: `provider`) são removidos e o `usage` sai sempre no formato padrão da OpenAI (sem `prompt_cache_hit_tokens` & cia).
- **D-048 — RATE_LIMITED não gera `UsageLog`.** Sob abuso, cada rejeição viraria uma escrita no banco. Saldo insuficiente e erros continuam gerando log.
- **D-049 — Só `n = 1`.** Simplifica reserva e cobrança.
- **D-050 — Limite de gasto mensal pelo `UsageLog`.** Soma de `chargedMicros` da chave desde o dia 1 do mês (UTC), com índice `(apiKeyId, createdAt)`. O banco é a fonte da verdade, não um contador no Redis.
- **D-051 — Catálogo em cache por 10 s.** Modelos, provedores e chaves decifradas ficam em memória por instância e são invalidados nas escritas do admin; outras instâncias convergem em até 10 s.
- **D-052 — BullMQ 5.** O BullMQ 6 adiciona peers opcionais (`pg`, `redis`). Fixado no 5.81 com ioredis 5.11, a mesma versão que ele usa.
- **D-053 — `END_USER_WALLET` aguarda a Fase 7.** Responde 400 `app_user_required` até existir identificação do usuário final. `HYBRID` cai na carteira da org, que é o comportamento do modo quando não há AppUser.
