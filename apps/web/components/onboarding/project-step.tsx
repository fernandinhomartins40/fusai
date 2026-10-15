'use client';

import { type BillingModeValue, createProjectSchema } from '@fusai/shared';
import { Button } from '@fusai/ui/components/button';
import { Input } from '@fusai/ui/components/input';
import { cn } from '@fusai/ui/lib/utils';
import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';
import { Field, FormAlert } from '@/components/form-field';
import { ApiError, apiFetch } from '@/lib/api';

type Values = z.input<typeof createProjectSchema>;

const modes: { value: BillingModeValue; title: string; description: string }[] = [
  {
    value: 'ORG_WALLET',
    title: 'Eu pago o consumo',
    description: 'O consumo de IA do app sai da carteira da sua organização.',
  },
  {
    value: 'END_USER_WALLET',
    title: 'Meus usuários pagam',
    description:
      'Seus usuários compram créditos via Pix dentro do app e consomem do próprio saldo.',
  },
  {
    value: 'HYBRID',
    title: 'Híbrido (freemium)',
    description: 'Usa o saldo do usuário final; se não houver, a sua organização cobre.',
  },
];

export function ProjectStep({
  orgId,
  onCreated,
}: {
  orgId: string;
  onCreated: (project: { id: string; name: string }) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const form = useForm<Values>({
    resolver: zodResolver(createProjectSchema),
    defaultValues: { billingMode: 'ORG_WALLET' },
  });
  const { errors, isSubmitting } = form.formState;
  const selected = form.watch('billingMode');

  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      const project = await apiFetch<{ id: string; name: string }>(
        `/internal/organizations/${orgId}/projects`,
        {
          method: 'POST',
          body: JSON.stringify(values),
        },
      );
      onCreated(project);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível salvar. Tente novamente.');
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-5">
      {error ? <FormAlert>{error}</FormAlert> : null}
      <Field id="project-name" label="Nome do projeto" error={errors.name?.message}>
        <Input
          id="project-name"
          placeholder="Ex.: Meu app"
          aria-invalid={!!errors.name}
          aria-describedby={errors.name ? 'project-name-error' : undefined}
          {...form.register('name')}
        />
      </Field>
      <fieldset className="grid gap-2">
        <legend className="mb-2 font-medium text-sm">Quem paga o consumo de IA?</legend>
        {modes.map((mode) => (
          <label
            key={mode.value}
            className={cn(
              'flex cursor-pointer gap-3 rounded-xl border p-3 transition-colors hover:bg-accent/50',
              selected === mode.value && 'border-fusai-accent/60 bg-accent/40',
            )}
          >
            <input
              type="radio"
              value={mode.value}
              className="mt-1 accent-[var(--fusai-accent)]"
              {...form.register('billingMode')}
            />
            <span className="grid gap-0.5">
              <span className="font-medium text-sm">{mode.title}</span>
              <span className="text-muted-foreground text-sm">{mode.description}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <Button type="submit" variant="brand" disabled={isSubmitting}>
        {isSubmitting ? <Loader2 className="animate-spin" /> : null}
        Criar projeto
      </Button>
    </form>
  );
}
