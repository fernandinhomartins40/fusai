# Relatório de validação final — auditoria PIE

- **Base:** commit `43dd2c3` + mudanças locais **sem commit** (nenhum push: push na `main` faz deploy).
- **Data:** 2026-10-22. **Ambiente:** dev local, Windows 11, Node 24 (a imagem de produção usa Node 22).
- **Banco de teste:** Postgres embutido de dev na porta 5433, banco `fuseai_pie_rec` em **UTF-8**. A porta 5432 é outra instância e recusa as credenciais do `.env`. Bancos criados em WIN1252 quebram o teste S-03 (caractere U+202E); produção é UTF-8.
- **Redis:** local, com prefixo aleatório por teste.
- **VPS:** só leitura, na coleta de 2026-10-21 ([RELATORIO_PERFORMANCE_VPS.md](RELATORIO_PERFORMANCE_VPS.md)). Nada foi alterado no servidor.

## 0. Rodada 2 (2026-10-22): decisões do dono implementadas

Validação feita depois que os 15 agentes da rodada 2 terminaram, com o mesmo ambiente descrito acima. O banco `fuseai_pie_final` foi criado do zero e confirmado em UTF-8 com `SHOW server_encoding`.

| Comando | Resultado |
|---|---|
| `prisma migrate diff --from-migrations … --to-schema-datamodel …` (shadow UTF-8) | "No difference detected": as 4 migrations escritas à mão batem com o schema |
| Revisão das migrations novas | Só acrescentam colunas, tabela e valores de enum; nenhum `DROP`, `DELETE` ou mudança de tipo |
| `pnpm typecheck` | 9/9 pacotes OK |
| `pnpm lint` (Biome) | 435 arquivos, sem erros |
| API `vitest run` (suíte completa) | **43/43 arquivos, 254/254 testes** |
| `@fusai/shared` / `@fusai/sdk` / `@fusai/docs` | 43/43 · 10/10 · 6/6 |
| `pnpm build` (com `apps/web/.next` apagado antes) | OK, 3/3 |
| Playwright do repositório (agente DX, `e2e/`) | 6/6, duas vezes; a web rodou a partir de uma cópia, por conflito de `.next` com outro agente |
| Playwright das telas logadas (agente E2E, scratchpad) | 16/16 telas verificadas, sem bugs |
| Lighthouse (agente Landing) | Desktop 99–100; celular: `/precos` e `/modelos` 92, home 75–90 (**abaixo da meta de 90**) |
| Gateway, overhead p95 (agente Perf, máquina dev) | 18,9 ms com 1 conexão ✅; 82 ms com 10 e 441 ms com 50 ❌; repasse do 1º chunk p99 < 3 ms ✅ |
| Varredura de segredos no diff | Sem chaves, tokens nem e-mails pessoais; só a credencial padrão de dev e o IP público que já estavam no repositório |
| VeloMail | Rastreamento de abertura e cliques desligado na conta; e-mail de teste aceito para entrega (domínio verificado); confirmação de chegada fica com o dono |

**Primeira rodada:** um arquivo falhou porque o banco tinha sido criado em WIN1252 (o `DROP` e o `CREATE` no mesmo script não rodaram, e o setup criou o banco com a codificação padrão). Depois de recriar o banco em UTF-8, tudo passou. Não houve mudança de código entre as duas rodadas.

**Riscos residuais da rodada 2:**
- **Segredos de produção:** o tamanho real não foi conferido (leitura da VPS negada). O deploy gera segredos com 64 caracteres, e o pré-teste mantém a versão atual no ar se a API nova não subir.
- **Imagem enxuta:** nunca foi construída num Docker real; o primeiro build será no CI.
- **Gateway:** o overhead com concorrência ≥ 10 está acima da meta. As otimizações recomendadas (réplicas, `relationJoins`, reserva sem transação interativa) dependem de aprovação.
- **Pendências do dono e do jurídico:** preencher `apps/web/lib/legal.ts` e revisar Termos e Privacidade; adicionar `email.bounced` e `email.spam_complaint` ao webhook do VeloMail e revogar a chave "fuseai" pelo painel, porque o MCP não oferece essas ações; cadastrar o 2FA do super admin no primeiro acesso; definir uma licença antes de publicar o SDK.

## 1. Comandos executados e resultados (rodada 1, depois das primeiras correções)

| Comando | Resultado |
|---|---|
| `pnpm typecheck` | 9/9 pacotes OK |
| `pnpm lint` (Biome) | 373 arquivos, sem erros |
| API: `vitest run` (suíte completa, `TEST_DATABASE_URL` UTF-8) | **30/30 arquivos, 191/191 testes** (inclui os 2 de R-01 marcados `it.fails`) |
| `pnpm --filter @fusai/shared test` | 6 arquivos, 43/43 |
| `pnpm --filter @fusai/sdk test` | 2 arquivos, 10/10 |
| `pnpm --filter @fusai/docs test` | 1 arquivo, 6/6 |
| `pnpm build` | OK, 3/3 tarefas do turbo |
| `pnpm audit --prod` antes | 27 alertas (2 críticos, 9 altos) |
| `pnpm audit --prod` depois | 6 alertas (2 críticos, 1 alto); todos vêm de ferramentas de teste/build, ver §4 |
| `next start` + curl (agente de UX) | `/` 200 com link para `/docs`; rota inexistente 404 em pt-BR; `/app` 307 para `/entrar`; cabeçalhos X-Frame-Options, nosniff e HSTS presentes |

Rodadas intermediárias: na 1ª rodada do inventário, 15 de 182 testes falharam, porque o schema mudou no meio da execução. Na 2ª, 6 de 184 falharam (detalhes em [MATRIZ_VERIFICACAO.md](MATRIZ_VERIFICACAO.md) §1). Todas foram resolvidas ou explicadas antes da rodada final.

**Teste de regressão provado:** o teste novo do D-08 foi rodado com a correção revertida e falhou ("Invalid decimal: abc"); com a correção, passou.

## 2. Correções implementadas e como foram verificadas

| ID | Correção | Prova |
|---|---|---|
| R-02 | Teto de saída da reserva enviado ao provedor (`max_tokens`) | `pie-receita.test.ts` (3 testes) |
| R-04/R-05 | Limite mensal da chave vale para session token; checagem atômica no `reserve()` | `pie-receita.test.ts` (R-04, 3 testes; R-05, 2 de concorrência que falhavam antes) |
| R-06/R-07 | Estorno confirmado no Asaas antes do débito; parcial, contestação e reversão vão para revisão (`payment.needs_review`); webhook `payment.refunded` com `refund` | `pie-estornos.test.ts` 3/3 |
| S-01 | MCP com chave de projeto segue as regras do painel (`billingMode`, `webhookUrl`, `allowedOrigins`) | `pie-security.test.ts` 5/5, `mcp.test.ts` 6/6 |
| S-02 | SSRF: IPv4 mapeado em IPv6, NAT64, faixas reservadas | `ssrf.pie.test.ts` (15) |
| S-03 | Nome e email do usuário final saneados e marcados como `untrusted` no MCP | `agent.test.ts` 5/5 |
| S-04 | Personificação registra `impersonatedBy` na auditoria | `admin-panel.test.ts` 11/11 |
| S-05 | 10 senhas erradas por conta em 15 min → 429 `ACCOUNT_TEMPORARILY_LOCKED`; o front mostra a mensagem certa | `auth.test.ts` 8/8; typecheck da web |
| S-06 | Tokens de convite, verificação e reset fora da URL logada | `logger.test.ts` |
| S-07 | Cabeçalhos de segurança na web | curl no `next start` |
| S-08 | `@modelcontextprotocol/sdk` 1.32.1, `nodemailer` 10, override de `postcss` ^8.5.23 | `pnpm audit`; suíte e build verdes |
| D-07 | Uma configuração inválida não derruba as outras (antes **lançava exceção**) | `settings.test.ts` |
| D-08 (novo) | Validador decimal recusava texto lançando exceção (500) em vez de 400 | `packages/shared/src/schemas/admin.test.ts` (falha sem a correção) |
| P-02…P-31, O-05, O-08, O-09 | 16 correções de UX/acessibilidade; retomar Pix pendente; abas explicadas por modo de cobrança; `ConfirmDialog` no lugar de 13 `confirm()` | typecheck, Biome, build, curl. **Telas logadas sem teste em navegador** |
| (bug novo) | "Gerar outro Pix" após expirar reaproveitava a mesma `Idempotency-Key` e devolvia o Pix expirado | Corrigido em `topup-dialog.tsx` pela leitura do código; **não testado em navegador** |

Documentação atualizada: `docs/DECISIONS.md` (D-129), `docs/API.md`, `packages/docs/content/02-autenticacao.md` e `08-webhooks.md` (regerado o `content.generated.ts`), `docs/PROGRESS.md` (gradiente).

Migration nova: `20261022120000_hold_api_key`. **Só acrescenta** uma coluna anulável com índice em `WalletHold`; não apaga nem reescreve dados.

## 3. Regressões encontradas e tratadas

- `end-users.test.ts`: a asserção de `apiKeyId: null` mudou porque o consumo por session token passou a ser atribuído à chave emissora. É uma mudança de comportamento intencional (D-129), não um defeito, e o teste foi ajustado.
- Na suíte com vários agentes em paralelo, alguns arquivos deram "Redis Connection is closed" no encerramento, sem teste reprovado. **Não reproduziu** na rodada final isolada (30/30).

## 4. Riscos residuais

- **R-01 (crítico, aberto):** o cliente pode criar créditos de usuário final sem pagar por eles. Os testes estão marcados `it.fails` e aguardam decisão.
- **Dependências restantes:** `vitest`, `@vitest/mocker` e `tinypool`, que chegam como peer do `better-auth` e são só de teste, e `deepmerge-ts`, do CLI do Prisma, só de build. Exigem vitest 4 e Prisma 7 (versões major); ficam para uma tarefa separada.
- **S-02:** DNS rebinding ainda é possível (o IP é checado antes e a conexão resolve de novo). **S-07:** falta CSP com nonce; o HSTS `includeSubDomains` depende de todos os subdomínios estarem em HTTPS.
- **Organizações INTERNAL:** o limite mensal continua sem checagem atômica.
- **Session tokens antigos** (sem `kid`): ficam sem limite mensal por até 15 minutos após o deploy.
- **Sem MFA** para o super admin.

## 5. Bloqueios (não verificado, com motivo)

- Asaas real (sandbox ou produção), VeloMail real e provedores de IA reais: sem credenciais de teste e sem autorização para cobranças ou envios. Só os simuladores foram usados.
- E2E em navegador das telas logadas e teste com leitor de tela: não executados.
- Processo do worker (BullMQ) em execução: não iniciado; os jobs são cobertos apenas pelos testes da API.
- VPS: sem medição antes/depois, porque nenhuma mudança de infraestrutura foi aplicada.
- LGPD: textos de Termos e Privacidade, prazos de retenção e exclusão/exportação dependem do jurídico ou encarregado.

## 6. Critérios de aceite (protocolo §12)

| Critério | Situação |
|---|---|
| Arquitetura e funcionalidades inventariadas | Sim: [INVENTARIO_APLICACAO.md](INVENTARIO_APLICACAO.md), 119 funções |
| Estado e evidência por jornada | Sim: [MATRIZ_VERIFICACAO.md](MATRIZ_VERIFICACAO.md) |
| Segurança, LGPD e receita avaliadas | Sim: [RELATORIO_SEGURANCA_LGPD_RECEITA.md](RELATORIO_SEGURANCA_LGPD_RECEITA.md) |
| Testes negativos de autorização e negócio | Sim (S-01, S-05, R-01, R-04/R-05, R-06, D-07, D-08) |
| Infraestrutura medida quando havia acesso | Sim, só leitura, em 2026-10-21 |
| Dados, integrações e regressões registrados | Sim |
| Correções seguras implementadas e verificadas | Sim; pendências justificadas no plano mestre |
| Testes, build e verificações registrados | Sim (§1) |
| Nenhum segredo ou dado pessoal nos artefatos | Varredura por regex (emails, chaves, URLs com senha, IPs) em `docs/pie/` e `DECISIONS.md`: só faixas reservadas de exemplo e o IP do servidor, que já constava antes |
| Riscos, bloqueios e decisões explícitos | Sim (§4, §5 e plano mestre) |

Conclusão: auditoria **concluída dentro do escopo acessível**, com os limites acima. Não se afirma que tudo funciona, que a aplicação é 100% segura nem que está em conformidade com a LGPD.
