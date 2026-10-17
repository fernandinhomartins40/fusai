# MCP

> Conecte a fusai à sua IA de programação (Claude Code, Cursor, VS Code, Claude Desktop) e deixe ela fazer a integração.

O servidor MCP remoto fica em `{{MCP}}` (transporte Streamable HTTP). Há dois tipos de chave:

| Chave | Onde criar | O que a IA pode fazer |
|---|---|---|
| **Chave de agente** (`fai_agent_...`) | Painel → **Agente de IA** (donos e admins) | Configurar a organização inteira: criar projetos e chaves, escolher uso próprio ou revenda, pacotes, webhook, recarga Pix, saldo, consumo e documentação. |
| **Chave do projeto** (`fai_live_...` com escopo `mcp`) | Projetos → Chaves | Trabalhar só naquele projeto (guia, testes, pacotes, configurações). |

Use a **chave de agente** para começar do zero. A IA cria a chave do projeto e grava em `FUSAI_API_KEY` no `.env` do servidor do seu sistema. A chave de agente fica só na configuração da sua IA, nunca no código.

## Casos de uso

- **Uso próprio:** você usa IA no seu sistema e paga o consumo (modo `ORG_WALLET`). A IA implementa as chamadas no backend e gera o Pix de recarga da sua carteira.
- **Revenda:** seus clientes compram créditos com Pix dentro do seu sistema, veem o saldo e consomem a IA (modo `END_USER_WALLET`). A IA cria os pacotes, configura origens e webhook e implementa a compra.
- **Híbrido:** usa o saldo do usuário e, quando acaba, o da organização (modo `HYBRID`).

Peça, por exemplo: *“Use o MCP fusai e configure a revenda de créditos neste sistema: meus clientes compram créditos com Pix aqui dentro, veem o saldo e usam a IA.”*

## Ferramentas da chave de agente

| Tool | O que faz |
|---|---|
| `get_account` | Organização, saldo, projetos e links. |
| `get_setup_guide` | Passo a passo para `uso_proprio`, `revenda` ou `hibrido`. |
| `search_docs` / `read_doc` | Busca e leitura da documentação. |
| `list_projects` / `get_project_config` | Projetos e configuração de cada um. |
| `get_integration_guide` | Código e checklist para a stack do sistema. |
| `list_models` | Modelos e preços em R$/1M tokens. |
| `get_balance` / `get_usage` / `list_payments` | Saldo (organização ou usuário final), consumo e pagamentos Pix. |
| `list_api_keys` / `list_packages` / `list_end_users` | Chaves, pacotes e usuários finais do projeto. |
| `create_project` | Cria um projeto com o caso de uso. |
| `create_api_key` / `revoke_api_key` | Cria a chave do projeto (aparece uma vez) ou revoga (`confirm`). |
| `update_project_settings` | Origens, webhook, modo de cobrança e crédito grátis (`confirm`). |
| `create_package` / `update_package` | Pacotes de créditos (mínimo R$ 5,00). |
| `create_topup_pix` | Pix para a carteira da organização (mínimo R$ 5,00). |
| `adjust_end_user_credits` | Cortesia ou correção no saldo de um usuário final (`confirm`). |
| `send_test_webhook` | Envia um `test.ping` para o webhook do projeto. |

Prompts prontos: `configurar_uso_proprio` e `configurar_revenda`. Tudo que a IA faz fica na auditoria da organização.

## Conectar

Os comandos são iguais para os dois tipos de chave (o painel Agente de IA já mostra o comando com a sua chave):

Claude Code:

```bash
claude mcp add --transport http fusai {{MCP}} --header "Authorization: Bearer fai_agent_..."
```

Cursor (`.cursor/mcp.json`), Claude Desktop e outros clientes com `mcpServers`:

```json
{
  "mcpServers": {
    "fusai": {
      "type": "http",
      "url": "{{MCP}}",
      "headers": { "Authorization": "Bearer fai_agent_..." }
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

## Ferramentas da chave do projeto

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
