# Auditoria PIE — Motor B: produto, UX e oportunidades

> Frente: produto e UX de `apps/web`, `packages/ui`, `packages/react` e `packages/docs`.
> Data: 21/10/2026. Fonte da verdade: `PRD.md` (§1.2, §9.3, §10.2, §11).

## 0. Método e limites

- **Análise estática do código.** Li páginas, layouts e componentes das rotas `(marketing)`, `(auth)`, `(dashboard)/app`, `(admin)/admin`, `pay/[checkoutId]` e `docs`, além de `packages/ui` (tokens e componentes), `packages/react` (checkout) e trechos da API para conferir comportamento (escopos de chave, templates de email).
- **Não executei** o web nem a API, não abri páginas no navegador, não rodei testes e não mexi no banco. Por isso **nada aqui está "verificado em execução"**. Os itens de contraste de cor são hipóteses, porque não medi as cores renderizadas.
- Referências no formato `arquivo:linha` (caminhos a partir de `apps/web/`, salvo indicação).
- Classificação: **fundamentada** significa que há evidência direta no código. **Hipótese** significa que é plausível, mas precisa ser validada com uso real ou com dados.

---

## 1. Mapa de jornadas

### J1. Cliente: da descoberta à primeira chamada com saldo

| # | Tela / ação | Arquivo | Passos do usuário | Observação |
|---|---|---|---|---|
| 1 | Landing `/` | `app/(marketing)/page.tsx` | 1 clique ("Criar conta") | Página provisória com o selo "Em construção" (:15, :59). O botão "Ver docs" não leva a lugar nenhum (:76). |
| 2 | Cadastro `/cadastro` | `components/auth/sign-up-form.tsx` | 4 campos + 1 clique | Os links de Termos e Privacidade apontam para páginas que não existem (:100, :104). |
| 3 | "Confirme seu email" | `app/(auth)/verificar-email/page.tsx` | sair do app, abrir o email, clicar no link | Boa tela, com reenvio e estados de link expirado ou inválido. |
| 4 | Email confirmado → `/app` → `/app/onboarding` | `verificar-email/page.tsx:32-62`, `components/auth/auto-redirect.tsx` | 0 a 1 clique (redireciona sozinho em 4 s) | — |
| 5 | Onboarding 1/3: organização | `components/onboarding/organization-step.tsx` | 3 campos (nome, CPF/CNPJ, telefone) + 1 clique | Exige CPF/CNPJ antes de a pessoa ver qualquer valor. |
| 6 | Onboarding 2/3: projeto | `components/onboarding/project-step.tsx` | 1 campo + escolha do modo de cobrança + 1 clique | Os textos dos 3 modos são bons para leigos. |
| 7 | Onboarding 3/3: chave | `components/onboarding/key-step.tsx` | 1 clique ("Gerar chave", nome já preenchido) + copiar + 1 clique | Depois vai para `/projetos/{id}/chaves` (:16), não para o Kit de Integração (PRD §11.3). |
| 8 | Recarga | `app/(dashboard)/app/(main)/page.tsx:47` → `carteira?recarga=1` → `components/topup/topup-dialog.tsx` | 1 clique + escolher pacote + "Gerar Pix" + pagar no banco | O diálogo é bom (QR, copia e cola, contagem, confete). |
| 9 | Primeira chamada | fora do painel (código/curl) ou MCP (comando no terminal) | colar o `.env` e o código, ou colar o comando MCP na IA | O painel não mostra se a primeira chamada deu certo, a não ser em Logs. |
| 10 | Acompanhar | Início, Consumo, Logs | navegação | Gráficos com tabela equivalente (bom para acessibilidade). |

**Contagem:** cerca de **9 telas**, **11 campos** e **cerca de 12 cliques** até ter chave e saldo, mais 2 saídas do produto (email e app do banco).

**Ponto de quebra principal (fundamentada):** o bônus de boas-vindas vem com padrão 0 (PRD §11.3 e o seed). O onboarding termina na chave sem falar de créditos, e o cartão "Comece por aqui" da visão geral (`(main)/page.tsx:102-119`) manda a pessoa para as chaves, não para a recarga. Resultado: o leigo gera a chave, faz a primeira chamada e recebe um erro 402 (sem saldo). O único aviso desse erro usa o próprio jargão técnico "402" (`(main)/page.tsx:64`).

### J1b. Cliente conectando a IA de programação (MCP)

Há **dois caminhos** que se sobrepõem:
- **Agente de IA** (`/app/agente`): usa uma chave da organização, e a IA configura tudo (D-123).
- **Kit de Integração** (`/app/projetos/{id}/integracao`): usa uma chave do projeto, com placeholder `fai_live_SUA_CHAVE` que o usuário precisa trocar à mão (`integracao/page.tsx:23,38-39`).

A única tela que já traz o comando MCP com a chave verdadeira é a revelação da chave (`components/api-keys/key-reveal.tsx:32`). São 3 a 4 passos: criar a chave, escolher o cliente MCP, copiar o comando e colar o prompt. O leigo não sabe qual dos dois caminhos escolher.

### J2. Super admin: colocar a operação para vender

| # | Tela / ação | Passos |
|---|---|---|
| 1 | `/entrar` → `/admin` | login |
| 2 | Provedores → Editar | colar a chave, marcar "ativo", salvar |
| 3 | Provedores → "Testar conexão" | 1 clique |
| 4 | Modelos → abrir o modelo | conferir custos (o seed cria modelos **inativos** com preço "verificar") e salvar |
| 5 | Modelos → interruptor "ativo" | 1 clique por modelo |
| 6 | Preços | câmbio, margem, recarga mínima, bônus |
| 7 | Pacotes | conferir os pacotes globais |
| 8 | Clientes → detalhe | ajustar saldo, suspender, entrar como cliente |

**Contagem:** cerca de **8 telas** e **15 ações** ou mais, sem nenhuma indicação de "pronto para vender". Se faltar um passo (por exemplo, nenhum modelo ativo), o cliente vê "Nenhum modelo ativo no momento" (`components/projects/allowed-models-form.tsx:90`) e as chamadas falham.

### J3. Usuário final: checkout hospedado `/pay/{id}`

1 tela e 2 a 3 ações: abrir o link vindo do app, copiar o código ou ler o QR, pagar no banco, a página atualiza sozinha e mostra "Voltar ao app". Os estados de carregando, não encontrado, erro com nova tentativa, pago, expirado e estornado estão cobertos (`app/pay/[checkoutId]/hosted-checkout.tsx`). **É a jornada mais redonda do produto.** Os problemas são de acessibilidade e de ordem dos elementos no celular (veja P-07 e O-14).

---

## 2. Problemas de UX e acessibilidade (P-xx)

### 2.1 Bloqueantes de produto e confiança

| ID | Problema | Evidência | Tipo |
|---|---|---|---|
| P-01 | Landing provisória: selo "Em construção", sem cabeçalho com Modelos, Preços e Docs, sem "Como funciona", sem calculadora, tabela de modelos, FAQ ou rodapé com CNPJ (PRD §11.2, Fase 9 ⏳). | `app/(marketing)/page.tsx:15,59` | fundamentada |
| P-02 | O botão "Ver docs" da landing não tem link: é um `<Button>` sem `asChild` ou `href`. | `app/(marketing)/page.tsx:75-77` | fundamentada |
| P-03 | `/termos` e `/privacidade` são citados no cadastro, mas não existem (dão 404). Isso é risco de LGPD e de confiança. | `components/auth/sign-up-form.tsx:100,104` | fundamentada |
| P-04 | Não há `error.tsx`, `not-found.tsx`, `global-error.tsx` nem `loading.tsx` em `app/`. As páginas lançam `throw new Error('Não foi possível carregar…')`, e o usuário cai na tela padrão do Next, em inglês e sem marca. Também não há esqueleto de carregamento nas páginas do servidor. | `(main)/page.tsx:31`, `carteira/page.tsx:29`, `consumo/page.tsx:41`, `logs/page.tsx:23`, `admin/page.tsx:40` | fundamentada |
| P-05 | Não há canal de suporte ou contato em nenhuma tela. Mesmo assim, a mensagem de conta bloqueada diz "Fale com o suporte da fusai". | `lib/auth-client.ts:22` | fundamentada |
| P-06 | Não há SEO: faltam `sitemap.ts`, `robots.ts`, `opengraph-image` e JSON-LD (PRD §11.2). | ausência em `app/` | fundamentada |

### 2.2 Jornada e conteúdo

| ID | Problema | Evidência | Tipo |
|---|---|---|---|
| P-08 | O onboarding termina na lista de chaves, e não no Kit de Integração prometido pelo PRD §11.3. | `components/onboarding/key-step.tsx:16` | fundamentada |
| P-09 | O cartão "Comece por aqui" ignora o saldo zerado e só aponta para as chaves. A primeira chamada leva 402. | `(main)/page.tsx:102-119` | fundamentada |
| P-10 | Jargão no alerta de saldo: "as requisições recebem 402". | `(main)/page.tsx:63-64` | fundamentada |
| P-11 | Quando a recarga está bloqueada, o motivo aparece só no `title` do botão desabilitado. Ele é invisível no toque (celular) e não é lido de forma confiável por leitores de tela. | `components/topup/topup-dialog.tsx:110-117` | fundamentada |
| P-12 | Ao fechar o diálogo, o Pix pendente se perde (`close()` zera o `payment`). O histórico mostra "Pendente", mas não deixa reabrir o QR, então a pessoa gera outro Pix e acumula cobranças. | `topup-dialog.tsx:69-73`, `components/payments-table.tsx:43-65` | fundamentada |
| P-13 | Os dois pontos de entrada para MCP (Agente de IA e Kit de Integração) não explicam quando usar cada um. | `components/shell/nav-config.ts:50,64`, `app/(dashboard)/app/(main)/agente/page.tsx`, `projetos/[id]/integracao/page.tsx` | fundamentada (a confusão é hipótese) |
| P-14 | O Kit de Integração usa uma chave placeholder que precisa ser trocada à mão, e a chave só aparece uma vez. | `projetos/[id]/integracao/page.tsx:23,38-39` | fundamentada |
| P-15 | As abas "Usuários finais" e "Pacotes de créditos" aparecem também em projetos "Eu pago o consumo" (`ORG_WALLET`), onde não se aplicam. | `components/projects/project-tabs.tsx:14-15` | fundamentada |
| P-16 | Chaves: não há como editar o nome ou os limites depois de criar (a API tem `apiKeyUpdateSchema`), e não há escolha de escopos. Toda chave nasce com **todos** os escopos, inclusive `mcp` e `app_users`. | `components/api-keys/create-key-form.tsx`, `packages/shared/src/schemas/api-keys.ts:15-18,26-32` | fundamentada |
| P-17 | O alerta de saldo baixo existe só na tela e no webhook. Não há email ao cliente (os templates são só de verificação, reset, convite e pagamento). | `apps/api/src/lib/email-templates.ts:22,35,48,61` | fundamentada |
| P-18 | A lista de projetos não tem estado vazio (um membro convidado sem projetos vê uma grade em branco). | `projetos/page.tsx:28-46` | fundamentada |
| P-19 | Termos misturados nos badges de chave: "live" no painel do cliente e "produção" no admin. | `api-keys-panel.tsx:93` vs `components/admin/admin-api-keys.tsx:43` | fundamentada |
| P-20 | O aviso de permissão usa o tom "success" (verde e `role="status"`) para dizer "Somente donos e admins podem alterar". | `components/org-settings-form.tsx:63-65` | fundamentada |
| P-21 | Admin: não há indicação de "pronto para vender" (provedor com chave, modelo ativo, Asaas, pacotes). O estado vazio dos provedores diz "Rode o seed". | `app/(admin)/admin/provedores/page.tsx:35` | fundamentada |
| P-22 | Admin: falta a saúde de cada provedor (latência, erros, circuit breaker) no card do provedor (PRD §11.5). O painel mostra apenas erros agregados. | `app/(admin)/admin/provedores/page.tsx:41-84`, `admin/page.tsx:105-110` | fundamentada |
| P-23 | O `docs/PROGRESS.md` (Fase 0) ainda descreve o gradiente "âmbar → rosa → violeta", que diverge da marca atual. | `docs/PROGRESS.md` (Fase 0, "Feito") | fundamentada |

### 2.3 Acessibilidade

| ID | Problema | Evidência | Tipo |
|---|---|---|---|
| P-07 | **Contagem regressiva dentro de `aria-live`.** O texto muda a cada segundo, e o leitor de tela anuncia o tempo sem parar durante o pagamento Pix. Aparece em 3 lugares: checkout hospedado, recarga e componente React. | `app/pay/[checkoutId]/hosted-checkout.tsx:161-172`, `components/topup/topup-dialog.tsx:262-275`, `packages/react/src/fuse-checkout.tsx:329-332` | fundamentada |
| P-24 | O `hint` do `Field` não tem `id` nem `aria-describedby`, então o leitor de tela não lê as dicas ("Vazio = sem limite", "Usado nas cobranças Pix"…). | `components/form-field.tsx:22-23` | fundamentada |
| P-25 | As abas de cliente MCP usam `role="tab"` sem `tabpanel`, sem `aria-controls` e sem navegação por setas. | `components/integration/mcp-commands.tsx:21-39` | fundamentada |
| P-26 | O painel não tem link "Pular para o conteúdo", e o `<main>` não tem `id`. A barra lateral tem 10 a 12 links antes do conteúdo. | `components/shell/app-shell.tsx:104-109` | fundamentada |
| P-27 | 13 ações destrutivas usam o `confirm()` nativo: sem marca, sem pt-BR garantido nos botões e ruim em WebView. | por exemplo, `api-keys-panel.tsx:32`, `webhook-secret.tsx:20`, `team-panel.tsx:182`, `admin/refund-button.tsx:21`, `admin/wallet-adjust-form.tsx:39` | fundamentada |
| P-28 | A contagem "Abrindo o painel em Ns…" também fica em `aria-live` (4 anúncios). | `components/auth/auto-redirect.tsx:19-21` | fundamentada (impacto baixo) |
| P-29 | Contraste: `--warning` no tema claro (`oklch(0.72 0.16 70)`) e `--success` (`oklch(0.6 0.15 155)`) são usados como **texto** pequeno ("Senha média", "sem chave") sobre fundo branco. Provavelmente ficam abaixo do AA (4,5:1). | `packages/ui/src/styles/globals.css:46-47`, `components/auth/password-strength.tsx:10-11`, `admin/provedores/page.tsx:60` | hipótese (medir) |
| P-30 | Os rótulos da barra inferior móvel têm 11 px. | `app-shell.tsx:184,206,223` | hipótese (legibilidade) |
| P-31 | O ícone X do `Dialog` não tem `aria-hidden` (o botão já tem rótulo, então só gera ruído). | `packages/ui/src/components/dialog.tsx:58` | fundamentada (impacto baixo) |
| P-32 | O CPF/CNPJ do componente React não tem máscara nem validação no cliente, então o erro só aparece depois de chamar a API. | `packages/react/src/fuse-checkout.tsx:204-214` | fundamentada |

### 2.4 Pontos fortes (para manter)

- Cadastro e login com campos rotulados, `aria-invalid` e `aria-describedby`, medidor de senha com texto alternativo e botão de mostrar senha acessível (`password-input.tsx`).
- Diálogos e "Mais" no celular usam o `<dialog>` nativo, com foco preso e Esc funcionando. O foco aparece globalmente (`globals.css:194-197`), e há `prefers-reduced-motion`.
- Gráficos com alternância para tabela (WCAG) em `charts/chart-card.tsx`.
- A marca está consistente: "fusai" minúsculo, `alt="fusai"` no logo, gradiente restrito a CTAs, passos e confete, dark-first (`theme-provider.tsx:9`), e o gradiente sem ciano onde há texto branco (contraste).
- Textos de UI em pt-BR. Não encontrei termos em inglês em texto visível, fora os jargões técnicos esperados (slug, rpm, webhook, MCP) e o badge "live".
- O checkout hospedado cobre todos os estados.

---

## 3. Oportunidades priorizadas (ELIMINAR → JUNTAR → AUTOMATIZAR → ANTECIPAR → CRIAR)

**Estado em 2026-10-22 (rodada 2):**

| Estado | Itens | Observação |
|---|---|---|
| Feito | O-02, O-04, O-05, O-06, O-08, O-09, O-10, O-11, O-12 | O-04 entrou como P-08 e O-08 como explicação nas abas, sem escondê-las. Detalhes em DECISIONS D-134. |
| Rascunho publicado | O-01 (parcial) | `/termos`, `/privacidade` e rodapé estão no ar. Faltam a landing completa e o CNPJ (**pendente do dono e do jurídico**). |
| Não decidido | O-03, O-07, O-13, O-14, O-15, O-16, O-17 | — |

Escala: impacto e esforço vão de **A**lto a **B**aixo; risco é o risco de regressão ou de negócio.

| ID | Alavanca | Oportunidade | Impacto | Esforço | Risco | Dependências | Justificativa | Tipo |
|---|---|---|---|---|---|---|---|---|
| O-01 | CRIAR | **Landing real (Fase 9)** com as 10 seções do PRD §11.2, mais as páginas `/termos`, `/privacidade` e contato/CNPJ, e SEO | A | A | B | conteúdo jurídico e CNPJ do dono; `/v1/models` público para a tabela | Hoje a landing diz "Em construção", e o cadastro cita páginas que não existem (P-01, P-02, P-03, P-05, P-06). É a porta de entrada da receita. | fundamentada |
| O-02 | ANTECIPAR | **Checklist de ativação no Início**: ✓ conta, ✓ projeto, ✓ chave, ☐ créditos, ☐ primeira chamada (detectada pelo `lastUsedAt` ou pelo primeiro `UsageLog`), com o próximo passo como CTA | A | M | B | dados que já existem (overview, chaves) | Evita o 402 na primeira chamada (P-09) e substitui o cartão "Comece por aqui". | fundamentada |
| O-03 | ANTECIPAR | **Créditos no onboarding**: depois da chave, um passo opcional "Adicionar créditos (Pix a partir de R$ 5)" ou um bônus de boas-vindas para testar | A | M | M (custo do bônus) | decisão do dono sobre `welcome_bonus_micros` | O padrão 0 faz o primeiro uso falhar. Um bônus pequeno tende a converter mais. | fundamentada (efeito na conversão é hipótese) |
| O-04 | ELIMINAR | Onboarding passo 3 → **Kit de Integração** (ou Agente) em vez da lista de chaves | M | B | B | — | É o que o PRD §11.3 pede, e a chave verdadeira ainda está na memória do navegador (P-08). | fundamentada |
| O-05 | AUTOMATIZAR | **Retomar Pix pendente**: botão "Ver QR" nas recargas pendentes e reabrir automaticamente o último Pix pendente ao clicar em "Adicionar créditos" | M | M | B | `GET /internal/payments/:id` já existe | Evita cobranças duplicadas e abandono (P-12). | fundamentada |
| O-06 | ANTECIPAR | **Email de saldo baixo e de saldo zerado** ao dono ou financeiro, com o link da recarga (usando o `notifyOnce` que já existe) | A | M | B | template novo; preferências em Configurações | Hoje só o webhook avisa, e o cliente descobre pelo erro 402 em produção (P-17). | fundamentada |
| O-07 | JUNTAR | **Uma única entrada "Conectar minha IA"**: explicar Agente (organização) vs Kit (projeto) numa tela, ou fundir as duas, e gerar a chave inline já preenchendo o comando | M | M | M | decisão do dono (D-123) | Remove a escolha confusa e o placeholder (P-13, P-14). | fundamentada (confusão é hipótese) |
| O-08 | ELIMINAR | Abas condicionais pelo `billingMode` (esconder Usuários finais e Pacotes em `ORG_WALLET`, ou mostrar com uma explicação) | M | B | B | — | Menos ruído para quem só usa a IA (P-15). | fundamentada |
| O-09 | CRIAR | Componente **ConfirmDialog** em `@fusai/ui` para substituir os 13 `confirm()` | M | M | B | — | Consistência visual e acessibilidade, e funciona em WebView (P-27). | fundamentada |
| O-10 | AUTOMATIZAR | **"Pronto para vender" no admin**: checklist com provedor ativo e testado, ≥1 modelo ativo com preço conferido, Asaas configurado, pacotes e câmbio | M | M | B | dados do admin | Evita que o cliente veja "Nenhum modelo ativo" (P-21). | fundamentada |
| O-11 | ANTECIPAR | **Saúde por provedor** (latência p95, % de erro, circuit breaker) nos cards de Provedores | M | M | B | métricas da API | PRD §11.5 (P-22). | fundamentada |
| O-12 | ELIMINAR | Chaves com **escopos mínimos por padrão** (por exemplo, `chat` apenas, com "Avançado" para os outros) e **edição de limites** | M | M | M (quebra quem depende de todos os escopos) | decisão do dono | Menos exposição se a chave vazar (P-16). Também é tema do Motor C. | fundamentada |
| O-13 | ELIMINAR | **Adiar o CPF/CNPJ** do onboarding para a primeira recarga | M | M | M (Asaas exige o documento para o Pix) | decisão do dono | O cadastro fica mais curto: o leigo chega à chave sem dado fiscal. | hipótese |
| O-14 | ANTECIPAR | No celular, **copia e cola acima do QR** nos 3 checkouts, porque quem está no celular não consegue ler o QR da própria tela | M | B | B | — | A maior parte do Pix é feita no celular. | hipótese (validar com dados de dispositivo) |
| O-15 | CRIAR | **Login com Google** na UI (o Better Auth já suporta, segundo `PROGRESS` Fase 1) | B | B | B | credenciais OAuth | Menos atrito no cadastro. | hipótese |
| O-16 | CRIAR | Busca nas docs e CTA "Criar conta" no cabeçalho das docs | B | B | B | — | As docs são porta de entrada de devs (`app/docs/layout.tsx:19-27`). | hipótese |
| O-17 | CRIAR | Indicador **"primeira chamada recebida"** ao vivo no Kit ou na revelação da chave (polling do `lastUsedAt`) | M | M | B | endpoint de chaves | Fecha o ciclo da integração com feedback ("Funcionou!"). | hipótese |

---

## 4. Correções rápidas e seguras (sem decisão de produto)

**Estado em 2026-10-22:** as 16 foram feitas na rodada 1, com P-28 junto de P-07. Ficaram verificadas por typecheck, Biome, build e curl. As telas logadas não passaram por E2E. Em P-29, o contraste no tema claro foi de 2,48 e 3,57 para cerca de 5,0:1.

Mudanças de texto, ARIA ou estado. Nenhuma altera regra de negócio.

1. **P-07:** tirar a contagem de dentro do `aria-live`. Deixar só "Aguardando pagamento…" como região viva, ou anunciar apenas quando faltar 1 minuto. Arquivos: `hosted-checkout.tsx:161`, `topup-dialog.tsx:264` e `fuse-checkout.tsx:329`. Fazer o mesmo no `auto-redirect.tsx:19`.
2. **P-02:** colocar `asChild` e `<Link href="/docs">` no botão "Ver docs" da landing.
3. **P-04:** criar `app/not-found.tsx`, `app/error.tsx` e `app/global-error.tsx` em pt-BR com a marca, além de `loading.tsx` em `(dashboard)/app/(main)` e `(admin)/admin`.
4. **P-24:** dar `id={`${id}-hint`}` à dica no `Field` e incluí-la no `aria-describedby` dos inputs.
5. **P-10:** trocar "as requisições recebem 402" por "seus apps param de receber respostas da IA até você recarregar".
6. **P-11:** mostrar o motivo do bloqueio da recarga como texto visível ao lado do botão, e não só no `title`.
7. **P-08:** no `key-step.tsx:16`, redirecionar para `/app/projetos/{id}/integracao`.
8. **P-20:** usar um tom neutro ou informativo (não "success") para o aviso de permissão.
9. **P-19:** padronizar o badge para "produção" ou "teste" no painel do cliente.
10. **P-18:** criar o estado vazio da lista de projetos com o CTA "Novo projeto".
11. **P-25:** completar o padrão de abas (`aria-controls`, `role="tabpanel"`, setas), ou trocar por botões com `aria-pressed`.
12. **P-26:** adicionar o link "Pular para o conteúdo" e `id="conteudo"` no `<main>` do `AppShell`.
13. **P-31:** colocar `aria-hidden` no ícone X do `Dialog`.
14. **P-21:** trocar o estado vazio "Rode o seed" por "Cadastre o primeiro provedor".
15. **P-23:** atualizar a descrição do gradiente no `docs/PROGRESS.md`.
16. **P-29:** medir o contraste. Se ficar abaixo de 4,5:1, criar um token `--warning-foreground` e um `--success-foreground` mais escuros no tema claro, usados só em texto.

## 5. Mudanças que exigem decisão do dono

- **O-01:** conteúdo da landing, Termos, Privacidade, CNPJ e canal de suporte (texto jurídico).
- **O-03:** valor do bônus de boas-vindas, ou passo de recarga dentro do onboarding.
- **O-06:** quem recebe os alertas de saldo e com que frequência.
- **O-07:** fundir ou não Agente de IA e Kit de Integração (afeta a D-123).
- **O-12:** escopos padrão das chaves (pode quebrar integrações atuais, então precisa de migração e aviso).
- **O-13:** adiar o CPF/CNPJ (exige garantir o documento antes de qualquer Pix).
- **O-15:** login social.
- A marca técnica `fuse/auto` e `X-Fuse-Signature` aparece para os devs nos snippets (`key-reveal.tsx:47`, docs), enquanto a marca é "fusai". Renomear quebra a compatibilidade (D-126), então fica registrado só como ponto de consistência, **sem recomendação de mudar agora**.

## 6. Requisitos do PRD ausentes ou parciais (UX/produto)

| PRD | Requisito | Situação |
|---|---|---|
| §11.2 | Landing completa, SEO, Lighthouse ≥ 90 | **Ausente**: só existe o placeholder (Fase 9 ⏳). |
| §11.3 | Onboarding termina mostrando o Kit de Integração | **Parcial**: mostra a chave com o MCP, mas leva para a lista de chaves. |
| §11.1 | Componentes Sheet, Command, Tabs e TanStack Table | **Parcial**: implementações próprias e enxutas. Não há busca (Command). |
| §11.4 | Carteira: histórico de pagamentos | **Parcial**: lista as recargas, mas sem retomar o Pix pendente. |
| §11.4 | Configurações: alerta de saldo baixo | **Parcial**: configurável e mostrado na tela, sem email. |
| §11.5 | Provedores: saúde (latência, erros, circuit breaker) | **Ausente** na tela do provedor. |
| §10.3 | Docs: busca | Não exigida, mas recomendada (O-16). |
| §11.2 FAQ | Créditos expiram? LGPD? Apps nativos? | **Ausente** (depende da landing). |
