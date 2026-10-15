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
