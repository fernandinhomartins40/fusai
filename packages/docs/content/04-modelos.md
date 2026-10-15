# Modelos

> Lista de modelos, capacidades e preços em reais por milhão de tokens.

## Listar

```bash
curl {{V1}}/models -H "Authorization: Bearer $FUSAI_API_KEY"
```

Exemplo (preços ilustrativos):

```json
{
  "object": "list",
  "data": [
    {
      "id": "fuse/deepseek-chat",
      "object": "model",
      "name": "DeepSeek Chat",
      "context_window": 128000,
      "max_output_tokens": 8192,
      "capabilities": { "tools": true, "vision": false, "reasoning": false },
      "pricing": { "currency": "BRL", "unit": "1M tokens", "input": "1.540000", "cached_input": "0.154000", "output": "6.160000" }
    }
  ]
}
```

- Os preços já incluem tudo: o valor de `pricing` é o que sai da sua carteira.
- Valores em texto com 6 casas decimais (sem arredondamento de ponto flutuante).
- A lista mostra só os modelos liberados para o projeto (**Projetos → Modelos permitidos**). Chamar outro modelo: `403 model_not_allowed`.
- Chaves de teste (`fai_test_`) só veem os modelos baratos.

## Escolhendo um modelo

| Uso | Sugestão |
|---|---|
| Chat geral, barato e rápido | `fuse/deepseek-chat` |
| Raciocínio passo a passo | `fuse/deepseek-reasoner` |
| Código e agentes com ferramentas | `fuse/kimi-k2`, `fuse/glm-4.6` |
| Volume alto, respostas curtas | `fuse/qwen-plus` |

A lista ao vivo, com preços, está em `/v1/models` e na [página de preços]({{APP}}/#modelos).

## Estimando custo

`custo = (tokens de entrada × preço de entrada + tokens de saída × preço de saída) / 1.000.000`

Exemplo com preços ilustrativos: 1.000 tokens de entrada e 500 de saída a R$ 1,54 / R$ 6,16 por milhão custam R$ 0,00154 + R$ 0,00308 = **R$ 0,00462**.
