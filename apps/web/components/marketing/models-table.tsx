import { brlToMicros, formatBRL } from '@fusai/shared/money';
import { Badge } from '@fusai/ui/components/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@fusai/ui/components/table';
import type { PublicModel } from '@/lib/public-models';

const tokens = (n: number) =>
  n >= 1_000_000
    ? `${(n / 1_000_000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}M`
    : n >= 1000
      ? `${Math.round(n / 1000)}k`
      : `${n}`;

const price = (value: string) => formatBRL(brlToMicros(value), { precise: true });

/** Active models with list prices per 1M tokens (data from GET /public/models). */
export function ModelsTable({
  models,
  showCapabilities = false,
}: {
  models: PublicModel[];
  showCapabilities?: boolean;
}) {
  if (models.length === 0) {
    return (
      <p className="rounded-xl border p-6 text-center text-muted-foreground text-sm">
        A lista de modelos está indisponível no momento. Veja os modelos ativos pela API em{' '}
        <code className="font-mono">GET /v1/models</code>.
      </p>
    );
  }
  return (
    <div className="overflow-x-auto rounded-xl border">
      <Table>
        <caption className="sr-only">
          Modelos disponíveis e preços em reais por 1M de tokens
        </caption>
        <TableHeader>
          <TableRow>
            <TableHead scope="col">Modelo</TableHead>
            <TableHead scope="col">Contexto</TableHead>
            <TableHead scope="col" className="text-right">
              Entrada / 1M
            </TableHead>
            <TableHead scope="col" className="text-right">
              Saída / 1M
            </TableHead>
            {showCapabilities ? <TableHead scope="col">Recursos</TableHead> : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {models.map((m) => (
            <TableRow key={m.id}>
              <TableCell>
                <div className="font-medium">{m.name}</div>
                <div className="font-mono text-muted-foreground text-xs">
                  {m.id} · {m.provider}
                </div>
              </TableCell>
              <TableCell className="tabular-nums">{tokens(m.context_window)}</TableCell>
              <TableCell className="text-right tabular-nums">{price(m.pricing.input)}</TableCell>
              <TableCell className="text-right tabular-nums">{price(m.pricing.output)}</TableCell>
              {showCapabilities ? (
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    {m.capabilities.tools ? <Badge variant="outline">ferramentas</Badge> : null}
                    {m.capabilities.vision ? <Badge variant="outline">imagens</Badge> : null}
                    {m.capabilities.reasoning ? <Badge variant="outline">raciocínio</Badge> : null}
                  </div>
                </TableCell>
              ) : null}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
