# MCP

> Conecte a fusai à sua IA de programação (Claude Code, Cursor, VS Code, Claude Desktop) e deixe ela fazer a integração.

O servidor MCP remoto fica em `{{MCP}}` (transporte Streamable HTTP). Autentique com uma chave do projeto que tenha o escopo `mcp`.

## Conectar

Claude Code:

```bash
claude mcp add --transport http fusai {{MCP}} --header "Authorization: Bearer fai_live_..."
```

Cursor (`.cursor/mcp.json`), Claude Desktop e outros clientes com `mcpServers`:

```json
{
  "mcpServers": {
    "fusai": {
      "type": "http",
      "url": "{{MCP}}",
      "headers": { "Authorization": "Bearer fai_live_..." }
    }
  }
}
```

VS Code (`.vscode/mcp.json`):

```json
{
  "servers": {
    "fusai": {
      "type": "http",
      "url": "{{MCP}}",
      "headers": { "Authorization": "Bearer ${input:fusai-key}" }
    }
  },
  "inputs": [{ "id": "fusai-key", "type": "promptString", "description": "Chave fusai", "password": true }]
}
```

Depois peça à IA: *“Leia o FUSAI.md e use o MCP fusai para integrar chat com IA e compra de créditos via Pix neste projeto.”* O `FUSAI.md` é baixado em **Projetos → Kit de Integração**.

## Ferramentas

| Tool | O que faz |
|---|---|
| `get_integration_guide` | Guia personalizado do seu projeto (URL, modo de cobrança, modelos, pacotes) com exemplos para `nextjs`, `react-native`, `flutter`, `node`, `python` ou `laravel`. |
| `get_project_config` | Modo de cobrança, origens permitidas, webhook, pacotes e modelo padrão. |
| `list_models` | Modelos liberados e preços em R$/1M tokens. |
| `get_balance` | Saldo da organização ou de um usuário final (`externalId`). |
| `get_usage` | Consumo por modelo num período. |
| `test_chat` | Chamada curta de teste (cobrada). |
| `list_packages` / `create_package` | Pacotes de créditos do projeto. |
| `update_project_settings` | Origens permitidas, webhook e modo de cobrança (pede `confirm: true`). |
| `create_test_checkout` | Checkout Pix de teste (só com chave `fai_test_` e Asaas em sandbox). |
| `send_test_webhook` | Envia um `test.ping` para o seu webhook. |

## Recursos e prompts

- Recursos: `fusai://docs/api`, `fusai://docs/sdk`, `fusai://docs/checkout`, `fusai://project`.
- Prompts: `integrar_chat`, `integrar_compra_pix`, `migrar_de_openai`.

Toda chamada ao MCP fica registrada no log de auditoria da organização. Ferramentas que alteram o projeto ou geram custo avisam isso na descrição.
