# Limites

> Limites de requisições, gasto, tamanho e prazos.

## Requisições por minuto

| Credencial | Padrão |
|---|---|
| Chave de API | 120 req/min por chave (ajustável por chave no painel) |
| Session token | 60 req/min por usuário final |

Acima do limite: `429 rate_limited` com o header `retry-after`. As respostas do chat trazem `x-ratelimit-limit` e `x-ratelimit-remaining`.

## Gasto

- **Saldo pré-pago**: cada chamada reserva uma estimativa antes de rodar; sem saldo, `402`.
- **Limite mensal por chave** (opcional): ao atingir, `402 spend_limit_reached` e o webhook `usage.limit_reached`.
- **Alerta de saldo baixo**: configure em **Configurações → Alerta de saldo**; você recebe o webhook `balance.low`.

## Tamanhos e prazos

| Item | Limite |
|---|---|
| Corpo de `/v1/chat/completions` | 20 MB |
| Saída por resposta | `max_output_tokens` do modelo (veja `/v1/models`) |
| Session token | 15 minutos |
| Pix (checkout e recarga) | 60 minutos para pagar |
| Pacote de créditos | de R$ 0,01 a R$ 10.000,00 |
| Recarga da organização | até R$ 10.000,00 por Pix |
| Página pública de checkout | 30 consultas/min por IP |
| Webhook | resposta em até 10 s; 6 tentativas |

## Privacidade

A fusai **não armazena o conteúdo** das mensagens nem das respostas: só metadados de uso (tokens, modelo, latência, custo). Os provedores dos modelos processam o conteúdo conforme os próprios termos.
