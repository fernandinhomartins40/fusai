import { cn } from '../lib/utils';

/**
 * Logo oficial (PNG em apps/web/public/brand, servido em /brand):
 * - logo-fusai.png        texto escuro, para fundo claro
 * - logo-fusai-branco.png texto branco, para fundo escuro
 * - simbolo-fusai.png     só o símbolo
 * A troca entre claro e escuro é por CSS (classe `dark`), sem JavaScript.
 */
const BRAND = '/brand';

/** Só o símbolo (decorativo). Defina a altura pela classe, ex.: `h-6`. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <img
      src={`${BRAND}/simbolo-fusai.png`}
      alt=""
      aria-hidden="true"
      width={240}
      height={160}
      className={cn('h-6 w-auto select-none', className)}
      draggable={false}
    />
  );
}

/** Logo completo "fusai". Defina a altura pela classe (padrão h-7). */
export function Logo({ className }: { className?: string }) {
  const img = 'h-full w-auto select-none';
  return (
    <span className={cn('inline-flex h-7 items-center', className)}>
      <img
        src={`${BRAND}/logo-fusai.png`}
        alt="fusai"
        width={681}
        height={160}
        className={cn(img, 'dark:hidden')}
        draggable={false}
      />
      <img
        src={`${BRAND}/logo-fusai-branco.png`}
        alt="fusai"
        width={681}
        height={160}
        className={cn(img, 'hidden dark:block')}
        draggable={false}
      />
    </span>
  );
}
