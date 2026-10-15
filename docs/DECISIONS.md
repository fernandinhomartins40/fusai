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

## Fase 5

- **D-054 — Organização atual por cookie.** Com convites, uma pessoa pode estar em várias organizações. O cookie `fuse_org` (preferência, não autenticação) guarda a escolhida. Se a pessoa não pertence mais a ela, cai na primeira. Toda permissão continua sendo checada na API por membership.
- **D-055 — Dias no fuso de São Paulo com offset fixo −03:00.** O Brasil não tem horário de verão desde 2019. Agregações por dia usam `(createdAt AT TIME ZONE 'UTC') AT TIME ZONE 'America/Sao_Paulo'`, e os dias sem uso entram como zero na série.
- **D-056 — CSV seguro.** RFC 4180 com BOM (Excel abre os acentos) e proteção contra injeção de fórmula: células iniciadas por `= + - @` ganham `'`, exceto números negativos.
- **D-057 — Segredo do webhook cifrado.** O segredo HMAC precisa ser lido para assinar, então não pode ser hash: fica em AES-256-GCM, como as chaves de provedor. "Revelar" decifra sob demanda e "Rotacionar" gera `whsec_` + 32 bytes.
- **D-058 — Convites.** Token de 32 bytes aleatórios; no banco só o sha256. Validade de 7 dias, um convite pendente por email (o novo revoga o anterior). Só a conta com o mesmo email aceita. Admin não convida, edita nem remove donos; a organização nunca fica sem dono (409 `last_owner`).
- **D-059 — Papéis.** Dono: tudo. Admin: equipe (exceto donos), projetos e cobrança. Dev: projetos, chaves e modelos, mas não o modo de cobrança. Financeiro: leitura de carteira e consumo, sem editar projetos. Todos os membros leem análises e extrato.
- **D-060 — Trocar o CPF/CNPJ descarta `asaasCustomerId`.** O cliente no Asaas é atrelado ao documento; a próxima cobrança cria um novo.
- **D-061 — Pilhas `grid` com trilha encolhível.** O tema define `.grid { grid-template-columns: minmax(0, 1fr) }` na camada base. Sem isso, a trilha `auto` cresce até o min-content (uma linha longa de código alargava a página no celular). Os utilitários `grid-cols-*` continuam valendo.
- **D-062 — CORS com todos os métodos do painel.** O `@fastify/cors` libera só GET/HEAD/POST por padrão; o painel usa também PUT/PATCH/DELETE. Há teste de preflight.
- **D-063 — Gráficos sem animação.** Barras desenhadas já no estado final: sem rótulos sumindo durante a animação, e `prefers-reduced-motion` respeitado por construção.
- **D-064 — Cor dos gráficos validada.** Uma série por gráfico (ranking e tempo são magnitude, não identidade): `--chart-series` = `#7c3aed` (claro) e `#8b5cf6` (escuro), aprovados pelo validador de paleta nas superfícies reais dos cards. Ticks sem "R$" (a unidade vai no subtítulo) e com casas decimais suficientes para não mentir.
- **D-065 — Filtros na URL.** Consumo e Logs guardam os filtros na query string (dá para compartilhar o link). A troca usa `useTransition`: o conteúdo anterior fica a 50% de opacidade até o novo chegar, sem skeleton.

## Fase 6

Documentação do Asaas consultada em out/2026 (docs.asaas.com: cobranças via Pix, sobre os webhooks, eventos de cobrança, autenticação, sandbox).

- **D-066 — Autenticação da API Asaas.** Header `access_token` (não `Authorization: Bearer`) e `User-Agent` (obrigatório para contas criadas a partir de 13/06/2024). URLs: `https://api-sandbox.asaas.com/v3` e `https://api.asaas.com/v3`; `ASAAS_API_URL` sobrescreve (testes / Asaas falso).
- **D-067 — Idempotência pelo id do evento.** O webhook traz `id` (`evt_…`) e a entrega é "pelo menos uma vez". `InboundWebhookEvent.eventKey` = esse id; sem id, usa `evento:payment.id` (como o PRD sugeria). Evento repetido → 200 e nada mais.
- **D-068 — Pix vai de `PAYMENT_CREATED` direto a `PAYMENT_RECEIVED`.** `PAYMENT_CONFIRMED` (comum em cartão) também credita: o crédito é único de qualquer forma. `PAYMENT_OVERDUE`/`PAYMENT_DELETED` → `EXPIRED`/`CANCELED` (se não pago). `PAYMENT_REFUNDED` → débito `REFUND`.
- **D-069 — Nunca creditar só pelo corpo do webhook.** Antes de creditar, `GET /payments/{id}` confirma status pago e valor igual ao cobrado (divergência fica registrada no evento). Por isso a interface `PaymentProvider` ganhou `getPayment` e `cancel`, além do que o PRD listava.
- **D-070 — Expiração própria de 60 minutos.** O QR Code dinâmico do Asaas vale até 12 meses após o vencimento. Usamos 60 min (ou o prazo do Asaas, se menor). O job cancela a cobrança no Asaas (`DELETE`) para o QR deixar de ser pagável. Se ela já estiver paga, credita. Pagamento que chega com status local `EXPIRED` é creditado igualmente: o dinheiro entrou.
- **D-071 — Sandbox sem endpoint de confirmação.** O Asaas não confirma pagamento de sandbox por API (é o botão "Confirmar pagamento" no painel). A verificação automatizada usa um Asaas falso fiel à API (`apps/api/test/fake-asaas.ts`); o roteiro manual no sandbox está em PROGRESS.md.
- **D-072 — Webhook: persistir, responder 200 e processar na fila.** A rota só valida o token, grava o evento e enfileira. O worker processa. Um job de varredura (2 min) reprocessa eventos não processados (enfileiramento perdido, worker fora, Asaas indisponível), cobrindo o risco da fila do Asaas ser pausada após 15 falhas.
- **D-073 — Cliente Asaas por organização.** `notificationDisabled: true` (a FuseAI manda os próprios emails) e `externalReference = org:<id>`. O id fica em `Organization.asaasCustomerId` porque a API aceita duplicados.
- **D-074 — Taxa de recarga cobrada por cima.** Com `topup_fee_pct > 0`, o cliente paga `base + ⌈base × pct / 100⌉` e recebe `base` em créditos (+ bônus do pacote). Padrão 0%.
- **D-075 — Bônus de pacote separado no ledger.** `PURCHASE` (valor pago em créditos) + `BONUS` (bônus do pacote), ambos com `referenceId = payment.id`. O estorno debita o total creditado.
- **D-076 — Limites da recarga.** Máximo de R$ 10.000 por recarga (proteção contra erro de digitação), 10 recargas/min por usuário e `Idempotency-Key` por sessão do diálogo.
- **D-077 — Fila única `jobs`.** API e worker compartilham uma fila BullMQ (`fuse:bull:jobs`) com jobs nomeados. O worker passou a usar `loadEnv` (precisa do Asaas e do SMTP).
- **D-078 — TanStack Query só onde há dado vivo.** Entrou para o polling do status do Pix (a cada 3 s, para quando o status muda). O resto do painel segue com server components.

## Fase 7 — Usuários finais e checkout

- **D-079 — Session token é um JWT HS256 próprio.** São ~40 linhas sobre `node:crypto`, sem dependência: header fixo (`alg` não negociável), comparação em tempo constante e expiração conferida. O prefixo `fai_st_` distingue o token das chaves. Segredo: `SESSION_TOKEN_SECRET`. Não há revogação; o prazo curto (15 min) compensa.
- **D-080 — Origem é checada no gateway, não no CORS.** O CORS de `/v1` reflete qualquer origem e nunca usa cookies. O gateway recusa um session token cuja `Origin` não está em `allowedOrigins` e qualquer chave secreta que chegue com `Origin`, pois ela vazou para o front. Chamadas sem `Origin` (apps nativos, servidores) são aceitas.
- **D-081 — Escopo `balance` do session token equivale a `billing:read` só para o próprio saldo.** `/v1/usage` (consumo do projeto inteiro) e as rotas de AppUser exigem a chave secreta.
- **D-082 — API de usuário final em camelCase.** As rotas de AppUser, pacotes e checkout, e os payloads dos webhooks, usam camelCase, como os exemplos do PRD §9.3 (`externalId`, `checkoutId`, `copyPaste`…). As rotas compatíveis com OpenAI (`/chat/completions`, `/models`, `/balance`, `/usage`) seguem em snake_case.
- **D-083 — CPF do comprador pedido na primeira compra.** O Asaas exige nome + CPF/CNPJ. O checkout aceita `document`/`name` no corpo ou usa o do AppUser. Sem documento, responde 400 `document_required`, e o `<FuseCheckout/>` mostra o formulário. O documento e o cliente Asaas ficam no AppUser.
- **D-084 — Pacotes do projeto sem taxa e com mínimo de R$ 5.** O cliente define preço, créditos e bônus. A margem dele é o que cobra a mais. A taxa de recarga (`topup_fee_pct`) vale só para a recarga da própria organização. R$ 5 é o mínimo de cobrança do Asaas.
- **D-085 — O dinheiro das vendas aos usuários finais entra na conta da FuseAI.** O MVP não tem split nem repasse: a venda vira créditos na carteira do usuário final, consumidos pelo preço da FuseAI. Repasse ao cliente fica para a fase 2 do produto e está no checklist de produção (contador).
- **D-086 — Webhooks de saída pelo padrão outbox.** Os eventos de pagamento são gravados na mesma transação que muda o saldo, então não há crédito sem evento nem evento sem crédito. A entrega é feita pelo worker a cada 30 s e logo após cada webhook do Asaas. Um lease de 60 s em `nextAttemptAt` evita envio duplo. A entrega pode se repetir (o id `evt_…` permite deduplicar). `test.ping` não tem novas tentativas.
- **D-087 — Anti-SSRF nos webhooks.** Sem seguir redirects. Em produção só `https://` e todos os IPs resolvidos precisam ser públicos (sem 10/8, 127/8, 169.254/16, 172.16/12, 192.168/16, 100.64/10, ::1, fc00::/7, fe80::/10). Em dev é liberado, para testar com `localhost`.
- **D-088 — Segredo do webhook gerado sozinho.** Ao salvar a primeira URL, o projeto ganha um `whsec_…` (AES-256-GCM no banco), porque toda entrega precisa ser assinada. Continua revelável e rotacionável em Configurações.
- **D-089 — Checkout hospedado busca os dados no navegador.** `GET /public/checkout/:publicId` é público (o id aleatório de 24 caracteres é a credencial) e expõe só o necessário para pagar. Tem limite de 30 req/min por IP. A página não busca no servidor do Next porque, aí, todos os compradores dividiriam o mesmo IP no limite.
- **D-090 — `return_url` seguro.** O validador `safeReturnUrl` (`@fuseai/shared`) aceita http(s) com host ou deep link de esquema próprio (`meuapp://`). Bloqueia `javascript:`, `data:`, `vbscript:`, `file:`, `blob:` e `about:`. Vale tanto para o `returnUrl` gravado no checkout quanto para o `?return_url=` da página.
- **D-091 — `balance.low` por projeto, uma vez por dia.** O alerta é da carteira da organização, mas o webhook é do projeto. A chave Redis `low:<org>:<projeto>` (TTL 24 h) evita repetição. `usage.limit_reached` usa `limit:<chave>`.
- **D-092 — SDK e React sem dependências e sem CSS framework.** `@fuseai/sdk` usa só `fetch`, `TextDecoderStream` e WebCrypto. `@fuseai/react` usa estilos inline com variáveis `--fuse-*`, para funcionar em qualquer app sem Tailwind. Ambos exportam TS como o resto do monorepo; o build npm fica para a Fase 10.
- **D-093 — Pacote já vendido não é apagado.** Excluir um pacote com pagamentos só o desativa (`active=false`), mantendo o histórico. Sem vendas, ele é apagado. Limite de 20 pacotes por projeto.
- **D-094 — Ajuste manual de saldo do usuário final.** Só dono e admin. Positivo vira `BONUS`, negativo vira `ADJUSTMENT`, nunca abaixo do saldo disponível. Motivo obrigatório, `actorId` no ledger e `AuditLog app_user.adjust`.

## Fase 8 — MCP e Kit de Integração

- **D-095 — Docs em Markdown num pacote, não MDX.** O mesmo texto alimenta quatro saídas: as páginas `/docs`, `/llms.txt`/`/llms-full.txt`, os recursos MCP e o FUSEAI.md. Com MDX, o texto ficaria preso ao Next. Por isso `packages/docs/content/*.md` vira `content.generated.ts` (script + teste de sincronia). A web renderiza com `marked` (sem dependências) no servidor. Não há HTML no Markdown e o conteúdo é nosso.
- **D-096 — URLs por placeholder.** As docs usam `{{V1}}`, `{{MCP}}`, `{{API}}` e `{{APP}}`, trocados na renderização pelas URLs da instalação. Assim os exemplos funcionam em dev, staging e produção sem editar texto.
- **D-097 — MCP stateless com respostas JSON.** É um servidor e um transport por requisição, sem `mcp-session-id` e sem SSE (`enableJsonResponse`). Escala horizontalmente sem estado; `GET`/`DELETE /mcp` → 405. Nenhuma tool precisa de streaming nem de notificações.
- **D-098 — MCP só com chave secreta e escopo `mcp`.** Reusa a autenticação do gateway, então chave com `Origin` (navegador) também é recusada. Limite de 120 chamadas/min por chave. Cada conexão fica presa ao projeto da chave.
- **D-099 — `test_chat` passa pelo gateway de verdade.** Usa `app.inject` em `/v1/chat/completions` com o mesmo header `Authorization`: valida chave, escopo, modelo, saldo, cobrança e log como uma chamada real. Saída limitada a 64 tokens. A descrição avisa que é cobrada.
- **D-100 — Mudanças pelo MCP pedem confirmação explícita.** `update_project_settings` sem `confirm: true` só devolve a prévia (de → para), e a descrição orienta a IA a perguntar ao usuário. A tool expõe só origens, webhook e modo de cobrança. Nome, modelos e crédito grátis continuam só no painel.
- **D-101 — `create_test_checkout` exige chave de teste e Asaas em sandbox.** Assim uma IA não gera cobrança real. Usa o usuário final `mcp-teste` (criado se preciso) e um CPF de sandbox fixo quando ele não tem documento.
- **D-102 — Schemas de tools sem `type` em array.** Campos anuláveis viram texto (`""` = remover), porque `["string","null"]` quebra vários clientes MCP (o `--strict` do Inspector aponta isso).
- **D-103 — FUSEAI.md gerado pela API, sem segredos.** `GET /internal/projects/:id/fuseai-md` (qualquer membro). O conteúdo vem dos dados atuais do projeto: modo, modelos com preço, pacotes, origens e webhook. O recurso MCP `fuseai://project` devolve o mesmo arquivo.
- **D-104 — Comandos MCP com a chave real só na criação.** A chave completa aparece uma única vez, então o comando pronto para colar é mostrado junto dela. O Kit mostra o mesmo comando com `fai_live_SUA_CHAVE`.
- **D-105 — Guia de integração por stack.** São seis stacks com código completo: Next.js e Node (padrão quando `stack` não vem), React Native/Expo (sem streaming, porque o `fetch` do RN não faz stream; checkout pela página hospedada), Flutter, Python/FastAPI e Laravel. O fluxo muda conforme o modo de cobrança: `ORG_WALLET` mantém tudo no backend.

## Deploy na VPS (preparação)

- **D-106 — nginx do host em vez de Caddy.** A VPS 72.60.10.112 é compartilhada: o nginx do host e o certbot já ocupam as portas 80 e 443. O PRD previa Caddy com HTTPS próprio; aqui o TLS fica com o nginx do host (site `fuseai.com.br`, instalado uma vez por `deploy/setup-host.sh`), como os outros apps da VPS.
- **D-107 — Uma porta só: 127.0.0.1:3500.** Só o contêiner `fuseai-nginx` publica porta. Ele roteia pelo `Host`: `api.fuseai.com.br` vai para a API (sem buffer e com timeout de 600 s, para SSE e MCP) e `www`/apex vão para a web. API, worker, web, Postgres e Redis ficam só na rede interna do compose.
- **D-108 — Deploy só pelo GitHub Actions, no push da `main`.** Testes → imagens `fuseai-api` e `fuseai-web` no GHCR, referenciadas por digest → rsync de `deploy/` → `deploy.sh` na VPS → verificação no domínio público. Chave SSH dedicada (secret `FUSEAI_DEPLOY_SSH_KEY`), chave de host fixada em `.github/vps_known_hosts` com a impressão SHA256 conferida no workflow. O login no GHCR usa o token do próprio job, que expira ao final. Deploys entram em fila e nunca são cancelados no meio.
- **D-109 — Segredos de produção gerados na própria VPS.** Na primeira execução, o `deploy.sh` cria `/root/fuseai/deploy/.env` (permissão 600) com `openssl rand` e nunca o sobrescreve, porque trocar `ENCRYPTION_KEY` ou `KEY_PEPPER` invalida as chaves cifradas e todas as chaves de API. O rsync exclui `.env` e `images.env`.
- **D-110 — Backup antes de migrar, volta automática só das imagens.** Antes do `prisma migrate deploy` roda um `pg_dump -Fc` em `/root/fuseai/backups` (ficam os 14 mais recentes). Migração e seed rodam com a imagem nova antes de trocar os contêineres; se falharem, nada mudou. Se a saúde falhar depois da troca, o script volta às imagens anteriores (`images.env.previous`). Migrações não são desfeitas (são aditivas); o dump serve para restauração manual.
- **D-111 — Migração versionada é imutável.** O workflow falha se um `migration.sql` existente for alterado ou removido (o Prisma recusa checksum divergente). Para restaurar o conteúdo aplicado, a mensagem do commit leva `[migracao-revertida]`.
- **D-112 — Imagem da API completa.** A imagem da API leva o workspace inteiro com dependências (inclusive o CLI do Prisma e o `tsx`, usados na migração e no seed). Fica maior, mas é o mesmo ambiente dos testes. A web usa o `standalone` do Next, que é enxuto.
