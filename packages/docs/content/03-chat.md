# Chat Completions

> `POST /v1/chat/completions`, compatível com OpenAI: mensagens, streaming, ferramentas e saída em JSON.

## Requisição

```http
POST {{V1}}/chat/completions
Authorization: Bearer fai_live_...
Content-Type: application/json
```

```json
{
  "model": "fuse/deepseek-chat",
  "messages": [
    { "role": "system", "content": "Responda em português." },
    { "role": "user", "content": "O que é Pix?" }
  ],
  "temperature": 0.7,
  "max_tokens": 500
}
```

Obrigatórios: `model` e `messages`. Os demais campos do formato OpenAI (`stream`, `stream_options`, `temperature`, `top_p`, `max_tokens` / `max_completion_tokens`, `stop`, `seed`, `tools`, `tool_choice`, `response_format`…) são repassados ao modelo. `n` aceita só 1.

## Resposta

```json
{
  "id": "chatcmpl-...",
  "object": "chat.completion",
  "model": "fuse/deepseek-chat",
  "choices": [
    { "index": 0, "message": { "role": "assistant", "content": "Pix é..." }, "finish_reason": "stop" }
  ],
  "usage": { "prompt_tokens": 18, "completion_tokens": 42, "total_tokens": 60 }
}
```

O header `x-fuse-request-id` identifica a cobrança nos [logs do painel]({{APP}}/app/logs).

## Streaming

Com `"stream": true`, a resposta vem em Server-Sent Events (`data: {...}` até `data: [DONE]`), igual à OpenAI. Use `"stream_options": {"include_usage": true}` para receber o uso no último pedaço.

```ts
const stream = await client.chat.completions.create({
  model: 'fuse/deepseek-chat',
  messages: [{ role: 'user', content: 'Conte uma história curta' }],
  stream: true,
});
for await (const chunk of stream) process.stdout.write(chunk.choices[0]?.delta?.content ?? '');
```

Se o cliente desconectar no meio, a fusai cobra só o que foi gerado até ali.

## Ferramentas (function calling)

`tools` e `tool_choice` seguem o formato da OpenAI nos modelos com a capacidade `tools` (veja `capabilities` em `/v1/models`).

## Como a cobrança funciona

1. Antes de chamar o modelo, a fusai **reserva** uma estimativa (entrada + `max_tokens` de saída). Sem saldo para a reserva: `402 insufficient_funds`.
2. No fim, cobra o uso real (`prompt_tokens × preço de entrada + completion_tokens × preço de saída`, com tokens em cache mais baratos) e devolve o resto da reserva.

Dica: defina `max_tokens` para reservar menos e evitar 402 com saldo baixo.

## Fallback

Se o provedor do modelo falhar (erro 5xx, timeout ou limite), a fusai tenta automaticamente os modelos de reserva configurados. Nesse caso, o campo `model` da resposta mostra o modelo que realmente respondeu, e a cobrança usa o preço dele. A reserva prévia já considera o mais caro entre o pedido e os de reserva.
