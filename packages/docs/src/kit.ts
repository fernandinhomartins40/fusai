/** Ready-to-paste MCP connection snippets (PRD §10.2). `key` may be a placeholder. */
export function mcpSnippets(apiUrl: string, key: string) {
  const url = `${apiUrl.replace(/\/+$/, '')}/mcp`;
  return {
    claudeCode: `claude mcp add --transport http fusai ${url} --header "Authorization: Bearer ${key}"`,
    /** Cursor (.cursor/mcp.json), Claude Desktop, Windsurf and other `mcpServers` clients. */
    mcpServersJson: JSON.stringify(
      {
        mcpServers: { fusai: { type: 'http', url, headers: { Authorization: `Bearer ${key}` } } },
      },
      null,
      2,
    ),
    /** VS Code (.vscode/mcp.json). */
    vscodeJson: JSON.stringify(
      { servers: { fusai: { type: 'http', url, headers: { Authorization: `Bearer ${key}` } } } },
      null,
      2,
    ),
    env: `FUSAI_API_KEY=${key}\nFUSAI_BASE_URL=${apiUrl.replace(/\/+$/, '')}/v1`,
  };
}

export const SUGGESTED_PROMPT =
  'Leia o FUSAI.md e use o MCP fusai para integrar chat com IA e compra de créditos via Pix neste projeto.';

/** What to ask the customer's AI once the agent MCP (organization key) is connected. */
export const AGENT_PROMPTS = [
  {
    title: 'Uso próprio',
    prompt:
      'Use o MCP fusai e configure a fusai para uso próprio neste sistema: crie o projeto, a chave, implemente as chamadas de IA no backend e me diga quanto de saldo colocar.',
  },
  {
    title: 'Revenda de créditos',
    prompt:
      'Use o MCP fusai e configure a revenda de créditos neste sistema: meus clientes compram créditos com Pix aqui dentro, veem o saldo e usam a IA. Proponha os pacotes antes de criar.',
  },
  {
    title: 'Acompanhar',
    prompt:
      'Use o MCP fusai e me mostre o saldo, o consumo dos últimos 30 dias e os últimos pagamentos Pix.',
  },
] as const;
