import { formatBRL, MICROS_PER_CENT } from '@fusai/shared/money';
import { ChevronDown } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { isFilled, legal } from '@/lib/legal';

type Item = { q: string; a: ReactNode };

/** Landing FAQ. Commercial answers come from lib/legal.ts and stay hidden until the owner fills them. */
export function Faq({ minTopupCents }: { minTopupCents: number | null }) {
  const items: (Item | null)[] = [
    {
      q: 'Como funciona o pagamento com Pix?',
      a: (
        <>
          Você compra créditos pré-pagos em reais: gera o Pix no painel (QR Code ou copia e cola),
          paga no app do seu banco e o saldo entra assim que o pagamento é confirmado.
          {minTopupCents
            ? ` A recarga mínima é de ${formatBRL(BigInt(minTopupCents) * MICROS_PER_CENT)}.`
            : null}{' '}
          Cada chamada à API desconta do saldo o custo exato dos tokens usados.
        </>
      ),
    },
    isFilled(legal.faq.creditsExpire)
      ? { q: 'Os créditos expiram?', a: legal.faq.creditsExpire }
      : null,
    isFilled(legal.faq.refunds) ? { q: 'Posso pedir reembolso?', a: legal.faq.refunds } : null,
    {
      q: 'Os usuários do meu app podem comprar créditos?',
      a: 'Sim. Seu app emite um token de sessão para cada usuário, e ele paga com Pix pelo checkout pronto da fusai ou pelo componente React. Os créditos ficam na carteira do próprio usuário e você define os pacotes e o preço.',
    },
    {
      q: 'Vocês guardam o conteúdo das conversas? E a LGPD?',
      a: (
        <>
          Não gravamos o conteúdo das mensagens no banco nem nos logs: registramos só dados de uso
          (modelo, tokens, custo, tempo de resposta). No painel você exporta seus dados ou pede a
          exclusão da conta. Detalhes na <Link href="/privacidade">Política de privacidade</Link>.
        </>
      ),
    },
    {
      q: 'Onde os dados são processados?',
      a: 'A API e o banco de dados da fusai ficam em servidores contratados. O conteúdo de cada chamada é enviado ao provedor do modelo escolhido (DeepSeek, Moonshot, Zhipu, Alibaba, MiniMax ou OpenRouter), que pode processá-lo fora do Brasil, inclusive na China e nos Estados Unidos. Escolha o modelo de acordo com os dados que você envia.',
    },
    {
      q: 'Funciona em apps nativos?',
      a: 'Sim. A API é HTTP compatível com OpenAI e aceita chamadas sem navegador; o SDK @fusai/sdk funciona em React Native, e o checkout Pix hospedado abre em qualquer WebView ou navegador. Verifique as regras de pagamento da loja do seu app.',
    },
  ];

  return (
    <div className="divide-y rounded-2xl border">
      {items
        .filter((item): item is Item => item !== null)
        .map((item) => (
          <details
            key={item.q}
            className="group px-5 py-4 [&_a]:underline [&_a]:underline-offset-4"
          >
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-medium [&::-webkit-details-marker]:hidden">
              {item.q}
              <ChevronDown
                aria-hidden
                className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180"
              />
            </summary>
            <div className="mt-3 text-muted-foreground text-sm leading-relaxed">{item.a}</div>
          </details>
        ))}
    </div>
  );
}
