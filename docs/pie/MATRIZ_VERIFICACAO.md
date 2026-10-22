# Matriz de verificação (PIE §2.3)

- **Data:** 2026-10-22
- **Versão:** commit `43dd2c3` + mudanças locais não commitadas (correções PIE em andamento, incluindo a migration nova `20261022120000_hold_api_key`)
- **Ambiente:** dev local Windows 11, Node 24, Postgres 16 embarcado (porta 5433) com o banco de teste exclusivo `fuseai_pie_inv`, Redis local (6379). Asaas, provedores de IA e VeloMail substituídos por *fakes* de teste (`apps/api/test/fake-*.ts`), que ficam isolados nos testes e não fazem parte da aplicação.
- **Pré-condições:** `globalSetup` aplica as migrations no banco de teste. Cada arquivo de teste faz `TRUNCATE` das tabelas.
- **Regra de classificação:** VERIFICADA só quando um teste **executado nesta data** cobre o comportamento. Se houve só leitura do código, a função fica como IMPLEMENTADA, NÃO VERIFICADA. Os IDs são os do [INVENTARIO_APLICACAO.md](INVENTARIO_APLICACAO.md).

## 1. Execuções

| # | Comando | Resultado |
|---|---|---|
| 1 | `vitest run` (API) contra o Postgres da porta 5432 | **Não executou**: credenciais recusadas (P1000). A 5432 é outra instância (serviço `postgresql-x64-16`), não o banco do projeto. |
| 2 | `TEST_DATABASE_URL=…:5433/fuseai_pie_inv vitest run` (API), 1ª rodada | 28 arquivos, 182 testes: **167 passaram, 15 falharam**. A maioria das falhas vem de `The column WalletHold.apiKeyId does not exist`: outro agente criou a migration `hold_api_key` e mudou o schema enquanto a suíte rodava. Isso gerou 500 em cascata em `wallet`, `never-negative`, `auto-model` e `mcp test_chat`. |
| 3 | Mesma suíte, 2ª rodada (migration já presente) | 28 arquivos, 184 testes: **178 passaram, 6 falharam** (5 arquivos). Detalhes na §3. |
| 4 | `pnpm --filter @fusai/shared test` | 5 arquivos, **42/42** |
| 5 | `pnpm --filter @fusai/sdk test` | 2 arquivos, **10/10** |
| 6 | `pnpm --filter @fusai/docs test` | 1 arquivo, **6/6** |
| 7 | `pnpm typecheck` | **9/9 pacotes OK** |
| 8 | `pnpm lint` (Biome, só leitura) | 369 arquivos, **1 erro**: `apps/web/components/integration/mcp-commands.tsx:21` `lint/a11y/useSemanticElements` (`role="group"` → `<fieldset>`). O arquivo estava sendo editado em paralelo (P-25). |

Saídas brutas no scratchpad desta sessão (`api-tests.txt`, `api-tests-2.txt`, `test-*.txt`, `typecheck.txt`, `lint.txt`). Elas não contêm segredos: o `DATABASE_URL` não foi impresso.

**Não executado:** E2E/Playwright do web (39 páginas), `pnpm build`, o processo `worker.ts`, chamadas reais ao Asaas, aos provedores de IA e ao VeloMail, e qualquer acesso à VPS.

## 2. Resumo por estado

| Estado | Quantidade | IDs |
|---|---|---|
| VERIFICADA | 94 | ver §4 |
| FALHA REPRODUZIDA | 4 | A-06, G-12, E-02, E-10 |
| BLOQUEADA | 2 | M-11, I-01 |
| PARCIAL | 3 | P-09, P-11, U-01 |
| IMPLEMENTADA, NÃO VERIFICADA | 13 | A-07, G-19, P-10, AN-04, H-02, W-01, U-04, U-05, U-06, U-07, SDK-02, RC-01, X-01 |
| NÃO LOCALIZADA | 3 | I-02, U-02, U-03 |
| **Total** | **119** | |

Ressalvas dentro de VERIFICADA: P-01 e EM-01 foram verificados só contra *fakes*; a integração real com o Asaas e com o VeloMail está **BLOQUEADA** (sem credenciais de sandbox e sem autorização para cobranças ou envios reais). Em O-01, O-02, A-01, A-03 e E-06 a **API** está verificada, mas as telas não passaram por E2E.

### 2.1 Atualização após as correções (3ª rodada, 2026-10-22)

A suíte completa da API foi rodada de novo com todas as correções aplicadas, num banco de teste UTF-8 (`fuseai_pie_rec`, porta 5433): **30/30 arquivos e 191/191 testes passaram**. Mudanças de estado:

| ID | Antes | Agora | Prova |
|---|---|---|---|
| A-06 | FALHA REPRODUZIDA | **VERIFICADA** | `auth.test.ts` "PIE S-05" (429 `ACCOUNT_TEMPORARILY_LOCKED` após 10 senhas erradas, de vários IPs) |
| G-12 | FALHA REPRODUZIDA | **VERIFICADA** | `pie-receita.test.ts` R-04: 402 com session token; e os 2 testes de concorrência do R-05 |
| E-02 | FALHA REPRODUZIDA | **VERIFICADA** | `end-users.test.ts`: a asserção passou a esperar o `apiKeyId` da chave emissora (decisão D-129) |
| E-10 | FALHA REPRODUZIDA | FALHA REPRODUZIDA (marcada `it.fails`) | R-01 continua aguardando decisão do dono |

Totais atualizados: VERIFICADA 97, FALHA REPRODUZIDA 1, demais iguais (119 no total). Também passaram a ser cobertos por testes: estornos (`pie-estornos.test.ts`, 3/3), configurações (`settings.test.ts`), validador decimal (`packages/shared/src/schemas/admin.test.ts`), personificação com `impersonatedBy` (`admin-panel.test.ts`) e saneamento do MCP (`agent.test.ts`).

## 3. Itens não verificados, com falha ou bloqueados

| ID | Estado | Método | Evidência | Observação |
|---|---|---|---|---|
| A-06 | FALHA REPRODUZIDA | teste automatizado | `auth.test.ts:272` "PIE S-05: caps wrong passwords per account, across IPs, temporarily": esperado 429, recebido 200 | Teste novo de uma correção em andamento (S-05). A trava por conta ainda não está ativa. |
| G-12 | FALHA REPRODUZIDA | teste automatizado | `pie-receita.test.ts:89` "R-04: session token respeita o limite de gasto mensal": esperado 402, recebido 200 | Correção em andamento (R-04). R-05 (concorrência) já passa. |
| E-02 | FALHA REPRODUZIDA | teste automatizado | `end-users.test.ts:153` "session tokens: scoped, origin-checked, and charge the end user wallet": `expected {…(22)} to match object {…(2)}` | **Regressão**: passou na 1ª rodada e falhou na 2ª, depois de edições paralelas em `gateway`/`billing` (provável efeito da correção R-04). O agente dessa correção precisa reavaliar antes de qualquer commit. |
| E-10 | FALHA REPRODUZIDA | teste automatizado | `pie-receita.test.ts:65` (esperado `false`, veio `true`) e `:76` (esperado 10000000n, veio 1010000000n) | R-01: créditos de usuário final emitidos sem lastro. **Aguarda decisão do dono.** |
| M-11 | BLOQUEADA | teste automatizado | `agent.test.ts:276` "PIE S-03…": `PostgresError 22P05 … character 0xe2 0x80 0xae … has no equivalent in encoding "WIN1252"` (em `app-users/service.ts:41`) | É limitação do ambiente: o Postgres embarcado local foi criado com a codificação WIN1252 e rejeita o caractere U+202E que o teste usa. Para revalidar, é preciso um banco de teste em UTF8, como o do `docker compose`. Não prova falha da aplicação. |
| I-01 | BLOQUEADA | inspeção | `.github/workflows/deploy.yml`, `deploy/deploy.sh` | Nenhum deploy foi executado (push na main faz deploy; nesta auditoria a VPS é só leitura). |
| P-09 | PARCIAL | inspeção | `payments/asaas.ts:23-25,185-191` | Estorno parcial, chargeback e MED caem como `ignored` (D-09, R-06/R-07/R-11). |
| P-11 | PARCIAL | inspeção | `topup-dialog.tsx:69-73`, `payments-table.tsx:43-65` | Não dá para reabrir o QR de um Pix pendente (P-12 de produto). |
| U-01 | PARCIAL | inspeção | `(marketing)/page.tsx:15,59` | Landing provisória (Fase 9 do PRD ⏳). |
| A-07 | IMPLEMENTADA, NÃO VERIFICADA | inspeção | `apps/web/middleware.ts` | O middleware só verifica se existe o cookie. A checagem real fica nos layouts e na API, e esta última está verificada (O-03, A-08). |
| G-19 | IMPLEMENTADA, NÃO VERIFICADA | inspeção | `providers/openai-compatible.ts:53-64` | Suspeita de corte de streams com mais de 120 s (D-02). |
| P-10 | IMPLEMENTADA, NÃO VERIFICADA | inspeção | `payments/notify.ts`, `email-templates.ts:61` | Nenhum teste confirma o envio do email de pagamento. |
| AN-04 | IMPLEMENTADA, NÃO VERIFICADA | inspeção | `dashboard/routes.ts:49` | Exercitada só de forma indireta. |
| H-02 | IMPLEMENTADA, NÃO VERIFICADA | inspeção | `apps/web/app/api/health/route.ts` | O web não foi iniciado. |
| W-01 | IMPLEMENTADA, NÃO VERIFICADA | inspeção | `worker.ts:45-56` | Os handlers estão verificados (B-04, P-03, P-04, E-07). O agendamento e o consumo da fila no processo real não foram. Não há healthcheck do worker (V-05). |
| U-04 | IMPLEMENTADA, NÃO VERIFICADA | typecheck | `pnpm typecheck` OK | Sem E2E. |
| U-05 | IMPLEMENTADA, NÃO VERIFICADA | typecheck | arquivos novos `app/error.tsx`, `global-error.tsx`, `not-found.tsx`, `loading.tsx` | Criados por correção paralela (P-04). Não foram renderizados. |
| U-06 | IMPLEMENTADA, NÃO VERIFICADA | typecheck | `apps/web/next.config.ts` | Os cabeçalhos S-07 não foram observados numa resposta HTTP. |
| U-07 | IMPLEMENTADA, NÃO VERIFICADA | inspeção | `hosted-checkout.tsx` | A API está verificada (E-06). A UI não. |
| SDK-02 | IMPLEMENTADA, NÃO VERIFICADA | inspeção | `packages/sdk/src/client.ts:214-225` | Pela leitura do código, o polling para no primeiro erro de rede (D-17). |
| RC-01 | IMPLEMENTADA, NÃO VERIFICADA | inspeção | `packages/react/src/*` | O pacote não tem testes. |
| X-01 | IMPLEMENTADA, NÃO VERIFICADA | inspeção | `examples/next-pwa/app/api/webhooks/fuse/route.ts:25-28` | O GET sem autenticação lista os eventos (D-20). |
| I-02 | NÃO LOCALIZADA | inspeção | `PRD.md:825` × `deploy/deploy.sh:133-150` | Falta o backup diário com retenção de 7 dias. Existe só o dump antes de cada deploy (V-01/D-04). |
| U-02 | NÃO LOCALIZADA | inspeção | `PRD.md:106,719,767`, `sign-up-form.tsx:100,104` | `/termos` e `/privacidade` não existem (S-10/P-03). |
| U-03 | NÃO LOCALIZADA | inspeção | `PRD.md:767` | Nenhuma rota de exclusão de conta ou de exportação de dados (S-09). |

**Erros de suíte fora das asserções:** `mcp/pie-security.test.ts` (2ª rodada) e `mcp/agent.test.ts` (1ª rodada) registraram `Error: Connection is closed.` (ioredis) no encerramento. Os testes desses arquivos passaram, então o problema está na limpeza do Redis no teardown e não em comportamento da aplicação. Fica como pendência de higiene dos testes.

## 4. Funcionalidades VERIFICADAS (2ª rodada, 2026-10-22)

| Arquivo de teste (resultado) | IDs cobertos |
|---|---|
| `auth/auth.test.ts` (7 de 8; a falha é A-06) | A-01, A-02, A-03, A-04, A-05, A-08 |
| `admin/admin-panel.test.ts` (11/11) | A-08, A-09, A-10, AD-04, AD-05, AD-06, AD-07, AD-08, AD-09, AD-10 |
| `admin/admin.test.ts` (7/7) | A-08, AD-01, AD-02, AD-03 |
| `admin/organizations.test.ts` (4/4) | B-06, B-08, AD-05 |
| `dashboard/routes.test.ts` (4/4) | O-01, O-02, O-03 |
| `dashboard/dashboard-p5.test.ts` (11/11) | A-11, A-12, O-04, O-05, O-06, AN-01, AN-02, AN-03, B-07 |
| `dashboard/api-keys.test.ts` (4/4) + `api-keys/keys.test.ts` (3/3) | K-01, K-02, K-03, K-04 |
| `gateway/gateway.test.ts` (17/17) | G-01 a G-11, G-13, G-14 |
| `gateway/auto-model.test.ts` (3/3) | G-15 |
| `gateway/usage.test.ts` (4/4) + `shared/pricing.test.ts` + `shared/money.test.ts` | G-06, G-17 |
| `providers/sse.test.ts` (3/3) | G-02 |
| `lib/ssrf.pie.test.ts` (15/15) | G-20 |
| `billing/pie-receita.test.ts` (4 de 7; as falhas são E-10 e G-12) | G-16 (R-02), G-11 (R-05) |
| `billing/wallet.test.ts` (7/7) | B-01, B-02, B-03, B-04 |
| `billing/never-negative.test.ts` (3/3) | B-05, P-05 |
| `payments/payments.test.ts` (12/12) | P-01, P-02, P-03, P-04, P-05, P-06, P-07, AD-11 |
| `gateway/topups.test.ts` (3/3) + `sdk/account.test.ts` (3/3) | P-08 |
| `gateway/end-users.test.ts` (11 de 12; a falha é E-02) | E-01, E-03, E-04, E-05, E-06, E-07, E-08, E-09, G-18, O-07 |
| `mcp/mcp.test.ts` (6/6) | M-01 a M-06 |
| `mcp/pie-security.test.ts` (5/5, erro de teardown) | M-07 |
| `mcp/agent.test.ts` (4 de 5; a falha é M-11, bloqueada pelo ambiente) | K-05, M-08, M-09, M-10 |
| `email-webhooks/velomail.test.ts` (10/10) | EM-01, EM-02 |
| `health/routes.test.ts` (4/4) | H-01 |
| `lib/logger.test.ts` (2/2) | L-01 |
| `lib/crypto.test.ts`, `jwt.test.ts`, `csv.test.ts` | AD-01, E-03, B-07 |
| `docs/docs.test.ts` (6/6) | DOC-01, O-07 |
| `sdk/sdk.test.ts` (7/7) | SDK-01 |
| `shared/document.test.ts`, `password.test.ts`, `return-url.test.ts` | O-01 (CPF/CNPJ), A-03 (senha forte), E-06 (return_url) |

## 5. Validade

Estas provas valem para o estado do código em 2026-10-22, **com edições paralelas em andamento**. Depois que as correções de R-04, S-03, S-05 e as de web terminarem, a suíte precisa rodar de novo, e de preferência num Postgres UTF8, para fechar M-11 e confirmar E-02.
