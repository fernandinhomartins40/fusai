'use client';

import { createOrganizationSchema, formatDocument } from '@fusai/shared';
import { Button } from '@fusai/ui/components/button';
import { Input } from '@fusai/ui/components/input';
import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';
import { Field, FormAlert } from '@/components/form-field';
import { ApiError, apiFetch } from '@/lib/api';

type Values = z.input<typeof createOrganizationSchema>;
type Org = { id: string; name: string };

export function OrganizationStep({ onCreated }: { onCreated: (org: Org) => void }) {
  const [error, setError] = useState<string | null>(null);
  const form = useForm<Values>({ resolver: zodResolver(createOrganizationSchema) });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      const org = await apiFetch<Org>('/internal/onboarding/organization', {
        method: 'POST',
        body: JSON.stringify(values),
      });
      onCreated(org);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível salvar. Tente novamente.');
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-4">
      {error ? <FormAlert>{error}</FormAlert> : null}
      <Field id="name" label="Nome da empresa ou organização" error={errors.name?.message}>
        <Input
          id="name"
          autoComplete="organization"
          aria-invalid={!!errors.name}
          aria-describedby={errors.name ? 'name-error' : undefined}
          {...form.register('name')}
        />
      </Field>
      <Field id="document" label="CPF ou CNPJ" error={errors.document?.message}>
        <Input
          id="document"
          inputMode="numeric"
          placeholder="000.000.000-00"
          aria-invalid={!!errors.document}
          aria-describedby={errors.document ? 'document-error' : undefined}
          {...form.register('document', {
            onBlur: (e) => form.setValue('document', formatDocument(e.target.value)),
          })}
        />
      </Field>
      <Field id="phone" label="Telefone" error={errors.phone?.message}>
        <Input
          id="phone"
          type="tel"
          autoComplete="tel"
          placeholder="(11) 99999-0000"
          aria-invalid={!!errors.phone}
          aria-describedby={errors.phone ? 'phone-error' : undefined}
          {...form.register('phone')}
        />
      </Field>
      <Button type="submit" variant="brand" disabled={isSubmitting}>
        {isSubmitting ? <Loader2 className="animate-spin" /> : null}
        Continuar
      </Button>
    </form>
  );
}
