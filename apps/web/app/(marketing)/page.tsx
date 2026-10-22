import { Button } from '@fusai/ui/components/button';
import {
  ArrowRight,
  BarChart3,
  Code2,
  KeyRound,
  QrCode,
  Route,
  Sparkles,
  UserPlus,
  Users,
  Wallet,
} from 'lucide-react';
import Link from 'next/link';
import { DevSnippets } from '@/components/marketing/dev-snippets';
import { Faq } from '@/components/marketing/faq';
import { HeroCode } from '@/components/marketing/hero-code';
import { ModelsTable } from '@/components/marketing/models-table';
import { PriceCalculator } from '@/components/marketing/price-calculator';
import { Section } from '@/components/marketing/section';
import { SiteHeader } from '@/components/marketing/site-header';
import { SiteFooter } from '@/components/site-footer';
import { APP_URL } from '@/lib/config';
import { getPublicCatalog } from '@/lib/public-models';

// Provider names as text only: no third-party logos without permission (PRD §11.2).
const PROVIDERS = ['DeepSeek', 'Kimi', 'GLM', 'Qwen', 'MiniMax', 'OpenRouter'];

const STEPS = [
  {
    icon: UserPlus,
    title: 'Crie a conta',
    text: 'Cadastro em minutos, sem cartão. Adicione créditos com Pix quando quiser começar.',
  },
  {
    icon: KeyRound,
    title: 'Gere a chave e conecte o MCP',
    text: 'Uma chave por projeto. Conecte o MCP no Claude Code, no Cursor ou no VS Code.',
  },
  {
    icon: Sparkles,
    title: 'Sua IA integra, seus usuários pagam com Pix',
    text: 'A IA de programação faz a integração. Seus usuários compram créditos dentro do app.',
  },
];

const FEATURES = [
  {
    icon: Code2,
    title: 'Compatível com OpenAI',
    text: 'Use o SDK oficial: troque só a baseURL e a chave. Streaming, ferramentas e JSON.',
  },
  {
    icon: QrCode,
    title: 'Pix instantâneo',
    text: 'Créditos pré-pagos em reais, liberados assim que o pagamento é confirmado.',
  },
  {
    icon: Users,
    title: 'Créditos para seus usuários',
    text: 'Venda pacotes dentro do seu app com checkout pronto, SDK e componente React.',
  },
  {
    icon: Sparkles,
    title: 'MCP para IA de programação',
    text: 'Sua IA lê a documentação e o seu projeto e implementa a integração por você.',
  },
  {
    icon: BarChart3,
    title: 'Painel de consumo',
    text: 'Gasto por dia, por modelo e por chave, com logs, limites e alertas de saldo.',
  },
  {
    icon: Route,
    title: 'Fallback automático',
    text: 'Se um provedor falha, a chamada segue para um modelo reserva sem você mudar nada.',
  },
];

const SITE_URL = (process.env.APP_URL ?? APP_URL).replace(/\/+$/, '');

const jsonLd = {
  '@context': 'https://schema.org',
  '@graph': [
    { '@type': 'Organization', name: 'fusai', url: SITE_URL, logo: `${SITE_URL}/icon.png` },
    {
      '@type': 'SoftwareApplication',
      name: 'fusai',
      applicationCategory: 'DeveloperApplication',
      operatingSystem: 'Web',
      description:
        'Gateway de IA compatível com OpenAI, com DeepSeek, Kimi, GLM, Qwen e MiniMax, créditos pré-pagos em reais e recarga via Pix.',
      url: SITE_URL,
    },
  ],
};

export default async function HomePage() {
  const { models, topup } = await getPublicCatalog();
  const calcModels = models.map((m) => ({
    id: m.id,
    name: m.name,
    input: m.pricing.input,
    output: m.pricing.output,
  }));

  return (
    <div className="relative isolate">
      <script
        type="application/ld+json"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: static JSON-LD built from constants
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <div
        aria-hidden
        className="bg-grid absolute inset-x-0 top-0 -z-10 h-[40rem] opacity-40 [mask-image:radial-gradient(ellipse_at_top,black,transparent_70%)]"
      />
      <div
        aria-hidden
        className="bg-fusai-gradient absolute top-[-12rem] left-1/2 -z-10 h-[24rem] w-[min(48rem,100vw)] -translate-x-1/2 rounded-full opacity-20 blur-3xl"
      />

      <SiteHeader />

      <main id="conteudo">
        <section className="mx-auto grid max-w-6xl items-center gap-12 px-4 pt-14 pb-16 sm:px-6 sm:pt-20 lg:grid-cols-[1.1fr_1fr]">
          <div className="text-center lg:text-left">
            <h1 className="text-balance font-semibold text-4xl tracking-tight sm:text-5xl lg:text-6xl">
              Uma API. Os melhores modelos de IA.{' '}
              <span className="text-fusai-gradient">Pague com Pix.</span>
            </h1>
            <p className="mx-auto mt-6 max-w-xl text-pretty text-lg text-muted-foreground lg:mx-0">
              Modelos de ponta como DeepSeek, Kimi, GLM, Qwen e MiniMax a preço baixo, numa única
              API compatível com OpenAI, com créditos pré-pagos em reais.
            </p>
            <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center lg:justify-start">
              <Button asChild variant="brand" size="lg" className="w-full sm:w-auto">
                <Link href="/cadastro">
                  Criar conta <ArrowRight />
                </Link>
              </Button>
              <Button asChild variant="outline" size="lg" className="w-full sm:w-auto">
                <Link href="/docs">Ver docs</Link>
              </Button>
            </div>
          </div>
          <HeroCode />
        </section>

        <section aria-labelledby="provedores" className="border-y bg-muted/30">
          <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
            <h2 id="provedores" className="text-center text-muted-foreground text-sm">
              Modelos dos principais laboratórios, numa só chave
            </h2>
            <ul className="mt-4 flex flex-wrap justify-center gap-x-8 gap-y-3 font-semibold text-lg text-muted-foreground tracking-tight">
              {PROVIDERS.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </div>
        </section>

        <Section
          id="como-funciona"
          title="Como funciona"
          subtitle="Do cadastro à primeira venda em três passos."
        >
          <ol className="grid gap-4 md:grid-cols-3">
            {STEPS.map(({ icon: Icon, title, text }, i) => (
              <li key={title} className="rounded-2xl border bg-card p-6">
                <div className="flex items-center gap-3">
                  <span className="flex size-8 items-center justify-center rounded-full bg-accent font-semibold text-sm">
                    {i + 1}
                  </span>
                  <Icon aria-hidden className="size-5 text-fusai-accent" />
                </div>
                <h3 className="mt-4 font-medium">{title}</h3>
                <p className="mt-2 text-muted-foreground text-sm">{text}</p>
              </li>
            ))}
          </ol>
        </Section>

        <Section
          id="recursos"
          title="Recursos"
          subtitle="Tudo o que você precisa para colocar IA no seu produto e cobrar por ela."
        >
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map(({ icon: Icon, title, text }) => (
              <li key={title} className="rounded-2xl border bg-card p-6">
                <Icon aria-hidden className="size-5 text-fusai-accent" />
                <h3 className="mt-4 font-medium">{title}</h3>
                <p className="mt-2 text-muted-foreground text-sm">{text}</p>
              </li>
            ))}
          </ul>
        </Section>

        {calcModels.length > 0 ? (
          <Section
            id="calculadora"
            title="Quanto vai custar?"
            subtitle="Escolha o modelo e o volume do mês para ver uma estimativa em reais."
          >
            <PriceCalculator models={calcModels} />
          </Section>
        ) : null}

        <Section
          id="modelos"
          title="Modelos e preços"
          subtitle="Preço por milhão de tokens, em reais. Sem mensalidade."
        >
          <ModelsTable models={models.slice(0, 8)} />
          {models.length > 0 ? (
            <div className="mt-4 flex flex-wrap gap-2">
              <Button asChild variant="outline" size="sm">
                <Link href="/modelos">Ver todos os modelos</Link>
              </Button>
              <Button asChild variant="ghost" size="sm">
                <Link href="/precos">Como funcionam os preços</Link>
              </Button>
            </div>
          ) : null}
        </Section>

        <Section
          id="devs"
          title="Para devs"
          subtitle="Funciona com o SDK da OpenAI que você já usa. Ou deixe sua IA integrar via MCP."
        >
          <DevSnippets />
        </Section>

        <Section id="faq" title="Perguntas frequentes">
          <Faq minTopupCents={topup?.min_cents ?? null} />
        </Section>

        <section className="mx-auto max-w-6xl px-4 pb-20 sm:px-6">
          <div className="relative overflow-hidden rounded-3xl border bg-card px-6 py-12 text-center sm:px-12">
            <div
              aria-hidden
              className="bg-fusai-gradient absolute inset-x-0 top-0 h-1 opacity-80"
            />
            <Wallet aria-hidden className="mx-auto size-6 text-fusai-accent" />
            <h2 className="mt-4 text-balance font-semibold text-3xl tracking-tight">
              Comece agora e pague só o que usar
            </h2>
            <p className="mx-auto mt-3 max-w-xl text-muted-foreground">
              Crie a conta, gere a chave e faça a primeira chamada em minutos.
            </p>
            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Button asChild variant="brand" size="lg" className="w-full sm:w-auto">
                <Link href="/cadastro">
                  Criar conta <ArrowRight />
                </Link>
              </Button>
              <Button asChild variant="outline" size="lg" className="w-full sm:w-auto">
                <Link href="/docs">Ler a documentação</Link>
              </Button>
            </div>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
