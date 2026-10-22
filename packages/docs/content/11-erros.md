# Erros

> Formato dos erros e o que fazer em cada código.

Os erros seguem o formato da OpenAI:

```json
{ "error": { "message": "Saldo insuficiente. Adicione créditos para continuar.", "type": "billing_error", "code": "insufficient_funds" } }
```

Use `code` no seu código (estável); `message` é para pessoas (pt-BR). `type` segue o status: `invalid_request_error` (400/404), `authentication_error` (401), `billing_error` (402), `permission_error` (403), `rate_limit_error` (429) e `api_error` (5xx).

| HTTP | `code` | Significado e o que fazer |
|---|---|---|
| 400 | `invalid_request` | Corpo inválido (campo faltando, tipo errado). Veja `message`. |
| 400 | `app_user_required` | Projeto cobra do usuário final: use session token ou `X-Fuse-User`. |
| 400 | `external_id_required` | Checkout com chave secreta precisa de `externalId`. |
| 400 | `document_required` | Checkout precisa de CPF/CNPJ do comprador (`document`). |
| 400 | `invalid_return_url` | `returnUrl` deve ser https ou deep link. |
| 400 | `billing_mode_org_wallet` | Projeto em “Carteira da organização” não vende créditos. |
| 401 | `invalid_api_key` | Chave ausente, errada, revogada ou expirada; session token inválido ou expirado. |
| 402 | `insufficient_funds` | Saldo insuficiente para a reserva. Recarregue ou mostre o checkout. |
| 402 | `spend_limit_reached` | A chave atingiu o limite de gasto mensal. |
| 403 | `insufficient_scope` | A credencial não tem o escopo da rota. |
| 403 | `model_not_allowed` | Modelo não liberado para o projeto. |
| 403 | `origin_not_allowed` | Origem do navegador fora das origens permitidas. |
| 403 | `secret_key_in_browser` | Chave secreta usada no navegador. Use session token. |
| 403 | `secret_key_required` | Rota exclusiva da chave secreta (servidor). |
| 403 | `account_suspended` | Conta suspensa. Fale com o suporte. |
| 403 | `end_user_blocked` | Usuário final bloqueado após estornar ou contestar créditos já usados. Desbloqueie no painel (Usuários finais). |
| 404 | `model_not_found`, `app_user_not_found`, `package_not_found`, `checkout_not_found` | Recurso não existe. |
| 429 | `rate_limited` | Muitas requisições. Espere `retry-after` segundos. |
| 502 | `upstream_error` | O provedor do modelo falhou (após tentar os de reserva). Tente de novo. |
| 503 | `model_unavailable` | Modelo temporariamente indisponível. |

Erros 5xx e 429 podem ser repetidos com backoff exponencial. 4xx (exceto 429) não: corrija a requisição.
