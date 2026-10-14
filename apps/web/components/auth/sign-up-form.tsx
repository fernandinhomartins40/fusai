'use client';

import { PASSWORD_MIN_LENGTH, signUpSchema } from '@fuseai/shared';
import { Button } from '@fuseai/ui/components/button';
import { Input } from '@fuseai/ui/components/input';
import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';
import { Field, FormAlert } from '@/components/form-field';
import { authClient, authErrorMessage } from '@/lib/auth-client';

type Values = z.input<typeof signUpSchema>;

export function SignUpForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const form = useForm<Values>({ resolver: zodResolver(signUpSchema) });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    const { error } = await authClient.signUp.email({
      ...values,
      callbackURL: `${window.location.origin}/verificar-email?confirmado=1`,
    });
    if (error) return setError(authErrorMessage(error));
    router.push(`/verificar-email?email=${encodeURIComponent(values.email)}`);
  });

  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-4">
      {error ? <FormAlert>{error}</FormAlert> : null}
      <Field id="name" label="Nome" error={errors.name?.message}>
        <Input
          id="name"
          autoComplete="name"
          aria-invalid={!!errors.name}
          aria-describedby={errors.name ? 'name-error' : undefined}
          {...form.register('name')}
        />
      </Field>
      <Field id="email" label="Email" error={errors.email?.message}>
        <Input
          id="email"
          type="email"
          autoComplete="email"
          aria-invalid={!!errors.email}
          aria-describedby={errors.email ? 'email-error' : undefined}
          {...form.register('email')}
        />
      </Field>
      <Field
        id="password"
        label="Senha"
        error={errors.password?.message}
        hint={`Mínimo de ${PASSWORD_MIN_LENGTH} caracteres.`}
      >
        <Input
          id="password"
          type="password"
          autoComplete="new-password"
          aria-invalid={!!errors.password}
          aria-describedby={errors.password ? 'password-error' : undefined}
          {...form.register('password')}
        />
      </Field>
      <Button type="submit" variant="brand" disabled={isSubmitting}>
        {isSubmitting ? <Loader2 className="animate-spin" /> : null}
        Criar conta
      </Button>
      <p className="text-center text-muted-foreground text-xs">
        Ao criar a conta você concorda com os{' '}
        <a href="/termos" className="underline underline-offset-4">
          Termos de uso
        </a>{' '}
        e a{' '}
        <a href="/privacidade" className="underline underline-offset-4">
          Política de privacidade
        </a>
        .
      </p>
    </form>
  );
}
