import { compareDecimals } from '@fusai/shared';
import { formatBRL, MICROS_PER_CENT } from '@fusai/shared/money';
import { Button } from '@fusai/ui/components/button';
import type { Metadata } from 'next';
import Link from 'next/link';
import { ModelsTable } from '@/components/marketing/models-table';
import { PriceCalculator } from '@/components/marketing/price-calculator';
import { SiteHeader } from '@/components/marketing/site-header';
import { SiteFooter } from '@/components/site-footer';
import { getPublicCatalog } from '@/lib/public-models';

export const metadata: Metadata = {
  title: 'Preços',
  description:
    'Pague só o que usar: créditos pré-pagos em reais via Pix, cobrança por token e sem mensalidade. Veja o preço de cada modelo e estime o custo do mês.',
  alternates: { canonical: '/precos' },
};

export default async function PricingPage() {
  const { models, topup } = await getPublicCatalog();
  const facts = [
    'Sem mensalidade: você paga só pelos tokens usados.',
    topup
      ? `Créditos pré-pagos em reais, comprados com Pix a partir de ${formatBRL(BigInt(topup.min_cents) * MICROS_PER_CENT)}.`
      : 'Créditos pré-pagos em reais, comprados com Pix.',
    topup && compareDecimals(topup.fee_pct, '0') > 0
      ? `Taxa de ${topup.fee_pct.replace('.', ',')}% sobre cada recarga.`
      : null,
    'Cada chamada desconta o custo exato dos tokens de entrada e de saída, arredondado para cima ao micro-real.',
    'O saldo nunca fica negativo: sem saldo, a chamada é recusada e nada é cobrado.',
    'Limites de gasto mensal por chave e alertas de saldo baixo por e-mail.',
  ].filter((f): f is string => f !== null);

  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader />
      <main id="conteudo" className="mx-auto w-full max-w-6xl flex-1 px-4 pt-12 pb-20 sm:px-6">
        <h1 className="font-semibold text-4xl tracking-tight">Preços</h1>
        <p className="mt-3 max-w-2xl text-muted-foreground">
          Pague por uso, em reais. Sem plano e sem cartão de crédito.
        </p>
        <ul className="mt-8 grid gap-3 sm:grid-cols-2">
          {facts.map((f) => (
            <li key={f} className="rounded-xl border bg-card p-4 text-sm">
              {f}
            </li>
          ))}
        </ul>

        {models.length > 0 ? (
          <section aria-labelledby="calc" className="mt-14">
            <h2 id="calc" className="mb-6 font-semibold text-2xl tracking-tight">
              Estime o custo do mês
            </h2>
            <PriceCalculator
              models={models.map((m) => ({
                id: m.id,
                name: m.name,
                input: m.pricing.input,
                output: m.pricing.output,
              }))}
            />
          </section>
        ) : null}

        <section aria-labelledby="tabela" className="mt-14">
          <h2 id="tabela" className="mb-6 font-semibold text-2xl tracking-tight">
            Preço por modelo
          </h2>
          <ModelsTable models={models} />
        </section>

        <div className="mt-10 flex flex-wrap gap-2">
          <Button asChild variant="brand">
            <Link href="/cadastro">Criar conta</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/docs">Ver docs</Link>
          </Button>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
