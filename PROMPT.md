# Prompt para o Claude Code — FuseAI

> **Como usar:** crie uma pasta vazia `fuseai/`, coloque nela este `PROMPT.md` e o `PRD.md`, abra no VS Code, inicie o Claude Code e cole o bloco abaixo (tudo entre as linhas `---`). Depois de cada fase, revise, teste e mande “continue para a próxima fase”.

---

Você é um engenheiro de software sênior full-stack (TypeScript, Next.js, Fastify, Prisma, Docker) e designer de produto. Vamos construir do zero a **FuseAI** (www.fuseai.com.br), um hub/gateway de IA multi-provedor com cobrança pré-paga por tokens e recarga via Pix.

## Fonte da verdade
Leia **todo** o arquivo `PRD.md` antes de escrever qualquer código. Ele define produto, stack, modelo de dados, endpoints, fluxos de cobrança, Pix, MCP, telas, segurança e o plano por fases. Siga-o à risca. Quando algo não estiver especificado, escolha a solução mais simples e registre em `docs/DECISIONS.md`.

## Resumo do que estamos construindo
- **Landing page** de vendas com cadastro (Next.js).
- **Painel do cliente**: organizações, projetos, chaves de API, carteira de créditos, recarga via Pix, consumo, logs, webhooks e **Kit de Integração** (comandos MCP + arquivo `FUSEAI.md` para a IA do cliente implementar a integração sozinha).
- **Gateway compatível com OpenAI** (`/v1/chat/completions` com streaming) que roteia para provedores baratos (DeepSeek, Kimi, GLM, Qwen, MiniMax, OpenRouter como fallback) e cobra por token com margem configurável.
- **Carteiras** de organização e de **usuário final** com ledger imutável e reserva de saldo.
- **Compra de créditos dentro dos apps dos clientes** (web, PWA, nativo) via Pix: session tokens, checkout hospedado `/pay/[id]`, `@fuseai/sdk` e `@fuseai/react`.
- **Servidor MCP remoto** (Streamable HTTP) autenticado pela chave de API.
- **Painel super admin**: provedores e chaves, modelos e preços, câmbio e margem, clientes, ajuste de saldo, pagamentos, dashboard de receita × custo × margem, auditoria, impersonate.

## Stack obrigatória (detalhes no PRD, seção 3)
Turborepo + pnpm · TypeScript strict · Next.js 15 App Router · Tailwind v4 + shadcn/ui · Fastify 5 + zod · Better Auth · PostgreSQL 16 + Prisma 6 · Redis 7 + BullMQ · @modelcontextprotocol/sdk · Asaas (Pix) · Vitest + Playwright · Biome · Docker Compose (dev e prod) + Caddy.

## Regras de trabalho
1. **Trabalhe por fases** (PRD, seção 15). Comece pela **Fase 0**. Ao terminar cada fase:
   - rode `pnpm lint`, `pnpm typecheck` e `pnpm test`, e corrija tudo;
   - verifique os critérios de aceite da fase de verdade (subindo os serviços, chamando endpoints, abrindo páginas);
   - atualize `docs/PROGRESS.md` (o que foi feito, como testar, pendências);
   - faça um commit com mensagem convencional (`feat: fase 3 - billing core`);
   - **pare e me apresente um resumo curto** com os comandos para eu testar. Só siga para a próxima fase quando eu pedir.
2. Antes de começar a Fase 0, crie um plano curto da fase (tarefas) e um `CLAUDE.md` na raiz com: visão do projeto em 5 linhas, comandos (dev, build, test, db), convenções (código em inglês, UI em pt-BR, dinheiro em micros BigInt, nada de float para dinheiro), estrutura de pastas e a regra “consulte o PRD.md”.
3. **Dinheiro**: sempre inteiro em micro-reais (`BigInt`); pagamentos em centavos. Arredondamento de cobrança sempre para cima. Escreva testes para isso.
4. **Segurança**: nenhuma chave real no código; chaves de cliente só como hash com pepper; chaves de provedor criptografadas (AES-256-GCM); secret key nunca no front; webhooks idempotentes; zod em toda entrada; nunca logar segredos nem conteúdo de mensagens.
5. **Concorrência no saldo**: use exatamente o padrão reserva → liquidação do PRD (7.4) com `UPDATE ... WHERE saldo disponível >= reserva`. Escreva o teste de concorrência da Fase 3.
6. **Design**: moderno, limpo, dark-first com modo claro, fonte Geist, gradiente da marca âmbar → rosa → violeta usado com parcimônia, shadcn/ui, mobile-first, acessível. Antes de construir a landing e os painéis, crie em `packages/ui` o tema (tokens CSS), o logo SVG “fuseai” e os componentes base, e use-os de forma consistente.
7. **Provedores**: todos são compatíveis com OpenAI; implemente um `OpenAICompatibleProvider` genérico. Não invente preços: o seed usa valores de exemplo marcados “verificar” e o admin confirma no site oficial de cada provedor.
8. **Asaas**: implemente atrás da interface `PaymentProvider`. Use o ambiente sandbox em dev. Antes de codar, consulte a documentação oficial atual do Asaas (cobrança Pix, QR Code, webhooks e autenticação do webhook) e ajuste se algo divergir do PRD; registre a diferença em `docs/DECISIONS.md`.
9. **MCP**: use o SDK oficial TypeScript com transporte Streamable HTTP stateless, auth por Bearer com a chave do projeto. Teste com o MCP Inspector.
10. Prefira poucas dependências, bem conhecidas. Nada de abstrações desnecessárias. Arquivos pequenos e coesos, por módulo.
11. Se encontrar uma ambiguidade que muda a arquitetura, **pergunte** antes. Para decisões pequenas, decida e registre.
12. Ao final de tudo (Fase 10), escreva um `README.md` com: visão geral, setup local, variáveis de ambiente, como cadastrar provedores e modelos, como configurar o webhook no Asaas, deploy em VPS com Docker + Caddy (DNS de `www` e `api`), backup e checklist de produção (incluindo revisar termos dos provedores sobre revenda, LGPD e questões fiscais com contador).

## Comece agora
Leia o `PRD.md` inteiro, me mostre em até 15 linhas o seu entendimento do sistema e o plano da **Fase 0**, e então implemente a Fase 0.

---

## Prompts de apoio (use quando precisar)

**Continuar:**
> Fase X aprovada. Continue para a Fase X+1 seguindo o PRD.md.

**Corrigir algo:**
> Na fase atual, [descreva o problema]. Corrija, adicione um teste que reproduza o bug e rode a suíte inteira.

**Revisão de segurança antes do deploy:**
> Faça uma revisão de segurança completa do monorepo seguindo a seção 12 do PRD: autenticação, autorização (cliente não acessa dados de outra organização; só SUPER_ADMIN acessa /admin), chaves, webhooks, rate limit, CORS, injeção, vazamento de segredos em logs. Liste os problemas por severidade e corrija os críticos e altos.

**Revisão de design:**
> Revise visualmente a landing, o painel do cliente e o admin em 375px, 768px e 1440px. Ajuste espaçamentos, hierarquia tipográfica, estados vazios, loading (skeletons), erros e consistência com o design system do packages/ui.

**Adicionar um novo provedor:**
> Adicione o provedor [nome] (API compatível com OpenAI, base URL [url]) ao seed e garanta que o admin consiga cadastrar a chave, testar a conexão e ativar modelos dele.
