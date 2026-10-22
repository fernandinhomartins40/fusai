# Plano mestre da auditoria PIE

Commit base: `43dd2c3`. Início em 2026-10-21; última atualização em 2026-10-22, na rodada 2, depois das decisões do dono. Ambiente: dev local (Windows) e VPS só leitura. Todas as mudanças estão locais e **sem commit**, porque o push na `main` faz deploy.

## Entregáveis

| Documento | Estado |
|---|---|
| [INVENTARIO_APLICACAO.md](INVENTARIO_APLICACAO.md) | Feito (119 funções) |
| [MATRIZ_VERIFICACAO.md](MATRIZ_VERIFICACAO.md) | Feito; §2.1 tem a rodada 1. A rodada 2 entra na validação final. |
| [RELATORIO_SEGURANCA_LGPD_RECEITA.md](RELATORIO_SEGURANCA_LGPD_RECEITA.md) | Feito; estados atualizados na rodada 2 |
| [RELATORIO_PERFORMANCE_VPS.md](RELATORIO_PERFORMANCE_VPS.md) | Feito (medição só leitura em 2026-10-21) |
| [OPORTUNIDADES_PRODUTO.md](OPORTUNIDADES_PRODUTO.md) | Feito; estados atualizados na rodada 2 |
| [RELATORIO_VALIDACAO_FINAL.md](RELATORIO_VALIDACAO_FINAL.md) | Rodada 1 registrada; a rodada 2 será validada ao final |

Rodada 1, validação completa: typecheck 9/9, lint OK, API 191/191 em 30 arquivos, shared 43/43, sdk 10/10, docs 6/6, build OK; `pnpm audit --prod` caiu de 27 para 6 alertas.

Rodada 2, resultados informados por cada agente no próprio banco de teste. A validação consolidada ainda vai rodar.

| Agente | Resultado informado |
|---|---|
| Receita | `pie-receita` 13/13, `pie-estornos` 7/7 |
| Segurança | API 231/231 em 38 arquivos |
| Produto | API 229/231; as 2 falhas eram de outros agentes e foram corrigidas depois |
| LGPD | `privacy.test.ts` 10/10 |

## Achados e estado

Duplicatas unificadas: R-02 = D-01; D-04 = V-01; D-06 ⊂ R-05; P-02 = S-10.

| ID | Categoria | Problema | Prioridade | Estado |
|---|---|---|---|---|
| R-01 | Receita | Cliente emite créditos de usuário final sem lastro | Crítica | **Corrigido e verificado** (D-130) |
| R-02/D-01 | Receita | Teto de saída da reserva não era enviado ao provedor | Alta | **Corrigido e verificado** |
| S-01 | Segurança | Chave de projeto no MCP passava do papel de quem a criou | Alta | **Corrigido e verificado**; email aos donos ao mudar via MCP (D-132) |
| S-02 | Segurança | SSRF por IPv6 mapeado, NAT64 e faixas reservadas | Alta | **Corrigido e verificado**; DNS rebinding continua aberto |
| V-01/D-04 | Dados | Backup só antes do deploy, sem teste de restauração | Alta | **Aprovado** (D-133: diário, 7 dias, local, teste de restauração); implementação em andamento |
| R-04, R-05/D-06 | Receita | Limite mensal fora do session token; checagem não atômica | Média | **Corrigido e verificado** |
| R-06, R-07 | Receita | Estorno parcial, chargeback e falta de saldo do usuário final | Média | **Corrigido e verificado** (D-131) |
| R-11 | Receita | Pix pago depois de vencido ficava sem crédito | Média | **Corrigido e verificado** (D-131, `reconcile-payments`) |
| R-09 | Receita | Ajustes sem idempotência | Baixa | **Parcial** (painel aceita `Idempotency-Key`) |
| R-03 | Receita | Desconexão sem streaming paga só o prompt | Média | Pendente (precisa de política do dono) |
| S-03 | IA | Prompt injection indireta; chave MCP com escopos amplos | Média | **Corrigido e verificado** (D-132) |
| S-04 | Auditoria | Personificação não registrava o super admin | Média | **Corrigido e verificado** |
| S-05 | Identidade | Sem trava por conta e sem MFA | Média | **Corrigido**: trava, TOTP obrigatório para super admin e email de bloqueio (D-132) |
| S-06 | Segurança/LGPD | Tokens e ids na URL logada | Média | **Corrigido e verificado** |
| S-07 | Segurança | Faltavam cabeçalhos de segurança na web | Média | **Corrigido e verificado**; CSP com nonce pendente |
| S-08 | Supply chain | Dependências com alertas | Média | **Corrigido** (vitest 4 e Prisma 7 pendentes, só teste e build) |
| S-14 | Segurança | Segredos curtos aceitos em produção | Baixa | **Corrigido** (D-132); tamanho em produção **não verificado** |
| S-16 | Segurança | Tokens OAuth em texto puro | Baixa | **Corrigido** (D-132); AAD e CPF pendentes |
| D-07, D-08 | Dados | Configuração inválida derrubava todas; validador decimal dava 500 | Média/Baixa | **Corrigido e verificado** |
| S-09, S-10, S-11, D-05 | LGPD | Sem exclusão nem exportação; Termos e Privacidade em 404; sem retenção | Média | **Feito** (D-135: rascunho, exportação, exclusão, retenção desligada); **texto e prazos pendentes do jurídico** |
| V-02 a V-06 | Infra | Imagem 1,44 GB; rollback; deploy corta streams; worker sem healthcheck; sem limites | Média | **Aprovado** (D-133); implementação em andamento |
| P-02 a P-31 | UX | 16 correções rápidas | — | **Feito** |
| O-02, O-05, O-06, O-08, O-09, O-10, O-11, O-12 | Produto | Ativação, Pix pendente, email de saldo, abas, ConfirmDialog, prontidão e saúde no admin, escopos mínimos | — | **Feito** (D-134) |
| O-01, O-03, O-07, O-13, O-15 | Produto | Landing completa, bônus de boas-vindas, Agente×Kit, CPF adiado, login social | — | Não decidido nesta rodada |

## Decisões do dono (2026-10-22): todas as 10 foram tomadas

D-130 a D-135, em `docs/DECISIONS.md`:
- R-01: transferência da carteira da org.
- R-06: estorno parcial proporcional.
- Chargeback congela os créditos e bloqueia o usuário final com falta de saldo.
- R-11: crédito automático do Pix pago depois de vencido.
- S-03: chave MCP com escopos mínimos e email aos donos.
- S-05: MFA para super admin.
- Backup diário local com teste de restauração.
- Todas as melhorias de produto e de infraestrutura propostas.
- LGPD: rascunho e funcionalidades.
- S-14: segredos fortes exigidos já.

## O que ainda depende do dono ou do jurídico

1. Preencher `apps/web/lib/legal.ts`: razão social, CNPJ, endereço, email de suporte, encarregado e foro. Depois da revisão, marcar `draft: false`.
2. Termos: validade dos créditos, reembolso de saldo não usado, saldo ao encerrar a conta e teto de responsabilidade (hoje `[12]` meses, a conferir com o CDC).
3. Privacidade: bases legais, mecanismo de transferência internacional (China/EUA) e prazos de retenção.
4. Prazo da retenção de logs em admin → Sistema (hoje desligada; mínimo de 180 dias).
5. Dados dos usuários finais de um cliente que exclui a conta (regra contratual de operador).
6. Manter o CPF/CNPJ das organizações suspensas (fiscal).
7. Antes do deploy, confirmar que `BETTER_AUTH_SECRET` e `SESSION_TOKEN_SECRET` têm 32 caracteres ou mais em produção. Depois do deploy, o super admin cadastra o autenticador.
8. R-03: cobrar ou não o hold de saída quando o cliente desconecta.

## Regras desta execução

- Nenhum commit ou push sem aprovação: o push na `main` faz deploy. O dono aprovou o push depois da validação da rodada 2.
- O banco de teste precisa ser UTF-8 (`CREATE DATABASE ... ENCODING 'UTF8' TEMPLATE template0`).
