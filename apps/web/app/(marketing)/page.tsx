import { Badge } from '@fuseai/ui/components/badge';
import { Button } from '@fuseai/ui/components/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@fuseai/ui/components/card';
import { Logo } from '@fuseai/ui/logo';
import { ArrowRight, Code2, QrCode, Zap } from 'lucide-react';
import { ThemeToggle } from '@/components/theme-toggle';

// Placeholder home for Phase 0 — the full landing page is built in Phase 9.
const highlights = [
  {
    icon: Code2,
    title: 'Compatível com OpenAI',
    description: 'Troque só a baseURL e a chave. Streaming, tools e JSON mode.',
  },
  {
    icon: QrCode,
    title: 'Créditos via Pix',
    description: 'Recarga instantânea para você e para os usuários do seu app.',
  },
  {
    icon: Zap,
    title: 'MCP para sua IA',
    description: 'Conecte o Claude Code ou o Cursor e deixe a IA fazer a integração.',
  },
];

export default function HomePage() {
  return (
    <div className="relative isolate overflow-hidden">
      <div
        aria-hidden
        className="bg-grid absolute inset-0 -z-10 opacity-40 [mask-image:radial-gradient(ellipse_at_top,black,transparent_70%)]"
      />
      <div
        aria-hidden
        className="bg-fuse-gradient absolute top-[-12rem] left-1/2 -z-10 h-[24rem] w-[48rem] -translate-x-1/2 rounded-full opacity-20 blur-3xl"
      />

      <header className="mx-auto flex max-w-6xl items-center justify-between px-4 py-5 sm:px-6">
        <Logo />
        <ThemeToggle />
      </header>

      <main className="mx-auto max-w-6xl px-4 pt-16 pb-24 sm:px-6 sm:pt-24">
        <section className="mx-auto max-w-3xl text-center">
          <Badge variant="outline" className="mb-6">
            Em construção · Fase 0
          </Badge>
          <h1 className="text-balance font-semibold text-4xl tracking-tight sm:text-6xl">
            Uma API. Os melhores modelos de IA.{' '}
            <span className="text-fuse-gradient">Pague com Pix.</span>
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-pretty text-lg text-muted-foreground">
            DeepSeek, Kimi, GLM, Qwen e MiniMax numa única API compatível com OpenAI, com créditos
            pré-pagos em reais.
          </p>
          <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Button variant="brand" size="lg" className="w-full sm:w-auto">
              Criar conta <ArrowRight />
            </Button>
            <Button variant="outline" size="lg" className="w-full sm:w-auto">
              Ver docs
            </Button>
          </div>
        </section>

        <section className="mt-20 grid gap-4 sm:grid-cols-3">
          {highlights.map(({ icon: Icon, title, description }) => (
            <Card key={title}>
              <CardHeader>
                <Icon className="mb-2 size-5 text-fuse-pink" aria-hidden />
                <CardTitle>{title}</CardTitle>
                <CardDescription>{description}</CardDescription>
              </CardHeader>
              <CardContent />
            </Card>
          ))}
        </section>
      </main>
    </div>
  );
}
