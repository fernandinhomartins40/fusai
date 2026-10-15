# Autenticação

> Chaves secretas no servidor, session tokens no navegador e no app. Escopos, ambientes e boas práticas.

## Chave secreta (servidor)

Envie no header `Authorization`:

```http
Authorization: Bearer fai_live_...
```

- `fai_live_…`: produção. `fai_test_…`: teste, só com modelos baratos.
- A FuseAI guarda apenas um hash da chave. Se perder, gere outra e revogue a antiga em **Projetos → Chaves de API**.
- Cada chave pode ter limite de requisições por minuto, limite de gasto mensal e data de expiração.

**A chave secreta nunca pode ir para o front-end nem para o app.** Se a API recebe uma chave secreta com header `Origin` (vinda de um navegador), ela recusa com `403 secret_key_in_browser`.

## Escopos

| Escopo | Libera |
|---|---|
| `chat` | `/v1/chat/completions`, `/v1/models` |
| `billing:read` | `/v1/balance`, `/v1/usage` |
| `checkout` | `/v1/packages`, `/v1/checkout/*` |
| `app_users` | `/v1/app-users/*` (usuários finais e session tokens) |
| `mcp` | servidor MCP em `{{MCP}}` |

Chaves novas têm todos os escopos. Sem o escopo: `403 insufficient_scope`.

## Session token (navegador e app)

Para chamar a FuseAI direto do front-end ou do app do seu usuário, o **seu backend** gera um session token curto:

```bash
curl -X POST {{V1}}/app-users/usuario-123/session-token \
  -H "Authorization: Bearer $FUSEAI_API_KEY"
# { "token": "fai_st_...", "expiresAt": "...", "scopes": ["chat","checkout","balance"] }
```

- Vale 15 minutos e só para aquele usuário final.
- Escopos: `chat`, `checkout` e `balance`.
- No navegador, a origem da página precisa estar em **Configurações do projeto → Origens permitidas** (senão, `403 origin_not_allowed`).
- Apps nativos (sem `Origin`) também podem usar.

Veja [Usuários finais e session token](/docs/usuarios-finais).

## Agindo em nome de um usuário final

Do servidor, com a chave secreta, envie `X-Fuse-User: <externalId>` para cobrar ou consultar a carteira daquele usuário:

```bash
curl {{V1}}/chat/completions \
  -H "Authorization: Bearer $FUSEAI_API_KEY" \
  -H "X-Fuse-User: usuario-123" \
  -H "Content-Type: application/json" \
  -d '{"model":"fuse/deepseek-chat","messages":[{"role":"user","content":"Oi"}]}'
```
