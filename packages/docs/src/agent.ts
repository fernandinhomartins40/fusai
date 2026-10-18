import type { DocUrls } from './types';

/** The three ways a customer uses fusai; each maps to a project billing mode. */
export const USE_CASES = ['uso_proprio', 'revenda', 'hibrido'] as const;
export type UseCase = (typeof USE_CASES)[number];

export const USE_CASE_BILLING: Record<UseCase, 'ORG_WALLET' | 'END_USER_WALLET' | 'HYBRID'> = {
  uso_proprio: 'ORG_WALLET',
  revenda: 'END_USER_WALLET',
  hibrido: 'HYBRID',
};

const COMMON_RULES = `## Regras de segurança (sempre)

- A chave do projeto (\`fai_live_...\`) fica **só no servidor**, em variável de ambiente (\`FUSAI_API_KEY\`). Nunca no front, no app mobile, no repositório ou em logs. Atualize o \`.env.example\` sem o valor real.
- A chave de agente (\`fai_agent_...\`) é só para esta conexão MCP. Nunca escreva essa chave em arquivos do projeto.
- Navegador e app mobile falam com a fusai por **session token** (gerado pelo servidor do app, vale 15 minutos).
- Ações que mudam dinheiro ou desligam algo (revogar chave, mudar modo de cobrança, ajustar créditos) pedem \`confirm: true\`: mostre o resumo e peça confirmação ao usuário antes.
- Valores em dinheiro: texto em reais (\`"9.90"\`) nas tools; a API usa micro-reais (1 real = 1.000.000) em texto.
- O Pix tem mínimo de **R$ 5,00** por cobrança (limite do Asaas).`;

const PERSONAL = `## Caso 1: uso próprio (o dono do sistema usa IA no próprio sistema)

Quem paga o consumo é a organização. Os usuários do sistema não veem preço nem compram nada.

1. \`create_project\` com \`use_case: "uso_proprio"\` (modo de cobrança \`ORG_WALLET\`).
2. \`create_api_key\` (\`env: "live"\`) e grave a chave em \`FUSAI_API_KEY\` no servidor do sistema.
3. \`get_integration_guide\` com a \`stack\` do projeto e implemente as chamadas de IA **no backend** (SDK oficial da OpenAI com \`baseURL\` da fusai, ou \`@fusai/sdk\`).
4. **Tela de créditos dentro do sistema** (recomendado): numa área de admin do sistema, mostre o saldo, o consumo e o botão "Adicionar créditos (Pix)". O guia de \`get_integration_guide\` traz o código: rotas \`/v1/balance\`, \`/v1/usage\`, \`/v1/topup-options\`, \`/v1/topups\` atrás do login de admin (em Next.js: \`fusaiAccountHandler\` do \`@fusai/sdk/server\` + \`<FusaiTopup/>\` do \`@fusai/react\`). Assim o dono recarrega sem sair do sistema.
5. Saldo inicial agora: \`create_topup_pix\` gera um Pix para a carteira da organização (copia e cola aqui no chat). Também dá para recarregar no painel, em Carteira.
6. Acompanhe com \`get_balance\` e \`get_usage\`. Para não ficar sem saldo, sugira o alerta de saldo baixo no painel (Configurações).
7. Se um dia o sistema passar a **revender** créditos, nada precisa ser refeito: mude o modo do projeto para \`HYBRID\` ou \`END_USER_WALLET\` (\`update_project_settings\`) e siga o caso 2.`;

const RESALE = `## Caso 2: revenda (os clientes do sistema compram créditos e pagam o que usam)

Cada usuário final tem carteira própria, compra créditos com Pix **dentro do sistema** e o consumo sai do saldo dele.

1. \`create_project\` com \`use_case: "revenda"\` (modo \`END_USER_WALLET\`).
2. Pacotes de créditos: proponha 2 ou 3 pacotes (ex.: R$ 9,90 → R$ 9,00 de créditos; R$ 49,90 → R$ 50,00) e crie com \`create_package\` depois da confirmação do usuário.
3. Opcional: crédito grátis para cada usuário novo (\`update_project_settings\` com \`free_credit_brl\`).
4. \`update_project_settings\`: \`allowedOrigins\` com o domínio do front (ex.: \`https://app.cliente.com.br\`) e \`webhookUrl\` (https) de uma rota do backend que vai receber os avisos de pagamento.
5. \`create_api_key\` (\`env: "live"\`) e grave em \`FUSAI_API_KEY\` no servidor.
6. \`get_integration_guide\` com a \`stack\` e implemente, nesta ordem:
   - **Backend:** no login, \`POST /v1/app-users\` (upsert pelo id do usuário no sistema) e uma rota que devolve o session token (\`POST /v1/app-users/:externalId/session-token\`).
   - **Saldo:** \`GET /v1/balance\` com o session token (ou \`<FusaiBalance/>\` no React).
   - **Compra:** componente \`<FusaiCheckout/>\` (React), página hospedada (\`hostedUrl\` de \`POST /v1/checkout/pix\`, serve para qualquer app e WebView) ou tela própria com \`fuse.checkout.createPix\` + \`waitForPayment\`. Na primeira compra o Pix pede CPF/CNPJ.
   - **IA:** chamadas de chat com o session token; trate \`402 insufficient_funds\` abrindo a compra.
   - **Webhook:** rota que valida \`X-Fuse-Signature\` (HMAC SHA-256) e trata \`payment.received\` / \`app_user.credited\` (deduplique pelo \`id\` do evento).
7. Teste: \`send_test_webhook\`; uma compra real de R$ 5,00; \`list_end_users\` e \`get_balance\` com \`externalId\` para conferir o saldo.
8. Acompanhe: \`list_end_users\`, \`get_usage\`, \`list_payments\`. Para dar cortesia ou corrigir saldo de um usuário: \`adjust_end_user_credits\` (pede confirmação).`;

const HYBRID = `## Caso 3: híbrido (freemium)

Consome primeiro o saldo do usuário final; quando acaba, a organização paga. Bom para um plano grátis com compra opcional.
Siga o caso 2 com \`use_case: "hibrido"\` e mantenha saldo na carteira da organização (\`create_topup_pix\`), como no caso 1.`;

/** Markdown setup guide for the agent MCP (`get_setup_guide`). */
export function agentSetupGuide(urls: DocUrls, useCase?: UseCase): string {
  const api = urls.api.replace(/\/+$/, '');
  const sections = useCase
    ? [{ uso_proprio: PERSONAL, revenda: RESALE, hibrido: HYBRID }[useCase]]
    : [PERSONAL, RESALE, HYBRID];
  return `# Configurar a fusai com o agente de IA

A fusai (${api}/v1) é um gateway de IA compatível com a API da OpenAI, com cobrança em reais e Pix.
Esta conexão MCP usa uma **chave de agente** da organização: você pode criar projetos, chaves, pacotes, cobranças Pix de recarga e consultar saldo e consumo.

Comece com \`get_account\` para ver a organização e os projetos. Pergunte ao usuário qual é o caso, se ele ainda não disse:
- **uso próprio**: só ele (o dono do sistema) usa IA, e paga o consumo;
- **revenda**: os clientes dele compram créditos com Pix dentro do sistema dele;
- **híbrido**: grátis até acabar o saldo do usuário, depois a organização paga.

${sections.join('\n\n')}

${COMMON_RULES}

## Documentação

\`search_docs\` busca na documentação; \`read_doc\` lê uma página inteira. Painel: ${urls.app.replace(/\/+$/, '')}/app · Docs: ${urls.app.replace(/\/+$/, '')}/docs`;
}

/** Plain-text search over the doc pages (title, description, body), best matches first. */
export function searchDocPages<
  T extends { slug: string; title: string; description: string; body: string },
>(pages: T[], query: string, limit = 5) {
  const terms = query
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .split(/\s+/)
    .filter((t) => t.length >= 2);
  const fold = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  return pages
    .map((p) => {
      const head = fold(`${p.title} ${p.description}`);
      const body = fold(p.body);
      const score = terms.reduce(
        (sum, t) => sum + (head.includes(t) ? 5 : 0) + Math.min(body.split(t).length - 1, 10),
        0,
      );
      const at = terms.map((t) => body.indexOf(t)).find((i) => i >= 0) ?? -1;
      const snippet =
        at >= 0
          ? p.body
              .slice(Math.max(0, at - 120), at + 280)
              .replace(/\s+/g, ' ')
              .trim()
          : p.description;
      return { slug: p.slug, title: p.title, score, snippet };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
