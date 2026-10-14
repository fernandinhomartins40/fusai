import { Logo } from '@fuseai/ui/logo';
import type { Metadata } from 'next';
import Link from 'next/link';
import { CodeBlock } from '@/components/copy-button';
import { API_URL } from '@/lib/config';

export const metadata: Metadata = {
  title: 'Documentação',
  description: 'Como chamar a API da FuseAI: compatível com OpenAI, créditos em reais.',
};

/** Quick start (the full MDX documentation arrives with the Integration Kit). */
export default function DocsPage() {
  const base = `${API_URL}/v1`;
  return (
    <div className="mx-auto grid max-w-3xl gap-8 px-4 py-10 sm:px-6">
      <Link href="/" aria-label="FuseAI — página inicial" className="w-fit">
        <Logo />
      </Link>
      <div className="grid gap-2">
        <h1 className="font-semibold text-3xl tracking-tight">Início rápido</h1>
        <p className="text-muted-foreground">
          A API da FuseAI é compatível com a da OpenAI: use o SDK oficial trocando só a{' '}
          <code>baseURL</code> e a chave.
        </p>
      </div>
      <section className="grid gap-3">
        <h2 className="font-semibold text-xl">1. Gere uma chave</h2>
        <p className="text-muted-foreground text-sm">
          No painel, abra seu projeto → Chaves de API → Nova chave. Guarde-a no servidor (nunca no
          front-end).
        </p>
      </section>
      <section className="grid gap-3">
        <h2 className="font-semibold text-xl">2. Faça a primeira chamada</h2>
        <CodeBlock
          label="Node.js (SDK openai)"
          code={`import OpenAI from 'openai';

const client = new OpenAI({
  apiKey: process.env.FUSEAI_API_KEY,
  baseURL: '${base}',
});

const res = await client.chat.completions.create({
  model: 'fuse/deepseek-chat',
  messages: [{ role: 'user', content: 'Olá!' }],
});
console.log(res.choices[0].message.content);`}
        />
        <CodeBlock
          label="curl"
          code={`curl ${base}/chat/completions \\
  -H "Authorization: Bearer $FUSEAI_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"model":"fuse/deepseek-chat","messages":[{"role":"user","content":"Olá!"}]}'`}
        />
      </section>
      <section className="grid gap-3">
        <h2 className="font-semibold text-xl">Endpoints</h2>
        <ul className="grid gap-2 text-sm">
          <li>
            <code className="font-mono">GET /v1/models</code> — modelos disponíveis com preço em R$
            por 1M de tokens
          </li>
          <li>
            <code className="font-mono">POST /v1/chat/completions</code> — chat, com ou sem{' '}
            <code>stream</code>
          </li>
          <li>
            <code className="font-mono">GET /v1/balance</code> — saldo da carteira
          </li>
          <li>
            <code className="font-mono">GET /v1/usage</code> — consumo por modelo
          </li>
        </ul>
        <p className="text-muted-foreground text-sm">
          Erros seguem o formato da OpenAI. Sem saldo, a API responde{' '}
          <code>402 insufficient_funds</code>.
        </p>
      </section>
    </div>
  );
}
