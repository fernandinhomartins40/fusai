# Início rápido

> Crie a conta, gere uma chave e faça a primeira chamada em 2 minutos. A API é compatível com a da OpenAI.

## 1. Crie a conta e uma chave

1. Crie a conta em {{APP}}/cadastro e confirme o email.
2. No onboarding, crie a organização (com CPF ou CNPJ) e o primeiro projeto.
3. Gere uma chave de API. Ela começa com `fai_live_` (produção) ou `fai_test_` (teste) e aparece **uma única vez**.

Guarde a chave numa variável de ambiente do **servidor**:

```bash
FUSEAI_API_KEY=fai_live_...
FUSEAI_BASE_URL={{V1}}
```

## 2. Faça a primeira chamada

```bash
curl {{V1}}/chat/completions \
  -H "Authorization: Bearer $FUSEAI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model": "fuse/deepseek-chat", "messages": [{"role": "user", "content": "Olá!"}]}'
```

Com o SDK oficial da OpenAI, troque só `baseURL` e `apiKey`:

```ts
import OpenAI from 'openai';

const client = new OpenAI({
  apiKey: process.env.FUSEAI_API_KEY,
  baseURL: process.env.FUSEAI_BASE_URL, // {{V1}}
});

const res = await client.chat.completions.create({
  model: 'fuse/deepseek-chat',
  messages: [{ role: 'user', content: 'Olá!' }],
});
console.log(res.choices[0].message.content);
```

```python
from openai import OpenAI
import os

client = OpenAI(api_key=os.environ["FUSEAI_API_KEY"], base_url="{{V1}}")
res = client.chat.completions.create(
    model="fuse/deepseek-chat",
    messages=[{"role": "user", "content": "Olá!"}],
)
print(res.choices[0].message.content)
```

## 3. Adicione créditos

O consumo é pré-pago. Recarregue em **Carteira → Adicionar créditos** com Pix: o saldo cai em segundos. Cada resposta é cobrada pelos tokens usados, em reais, arredondando para cima no micro-real.

## Próximos passos

- [Modelos e preços](/docs/modelos)
- [Cobrar dos usuários do seu app](/docs/usuarios-finais)
- [Conectar sua IA de programação via MCP](/docs/mcp): ela faz a integração para você.
