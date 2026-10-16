'use client';

import { passwordStrength, signUpSchema } from '@fusai/shared';
import { Button } from '@fusai/ui/components/button';
import { Input } from '@fusai/ui/components/input';
import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2 } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';
import { PasswordInput } from '@/components/auth/password-input';
import { PasswordMatch, PasswordStrengthMeter } from '@/components/auth/password-strength';
import { Field, FormAlert } from '@/components/form-field';
import { authClient, authErrorMessage } from '@/lib/auth-client';

type Values = z.input<typeof signUpSchema>;

export function SignUpForm() {
  const router = useRouter();
  const next = useSearchParams().get('next');
  const confirmed = `/verificar-email?confirmado=1${next ? `&next=${encodeURIComponent(next)}` : ''}`;
  const [error, setError] = useState<string | null>(null);
  const form = useForm<Values>({ resolver: zodResolver(signUpSchema), mode: 'onTouched' });
  const { errors, isSubmitting } = form.formState;
  const password = form.watch('password') ?? '';
  const confirm = form.watch('confirm') ?? '';
  const ready = passwordStrength(password).valid && password === confirm;

  const onSubmit = form.handleSubmit(async ({ name, email, password }) => {
    setError(null);
    const { error } = await authClient.signUp.email({
      name,
      email,
      password,
      callbackURL: `${window.location.origin}${confirmed}`,
    });
    if (error) return setError(authErrorMessage(error));
    router.push(`/verificar-email?email=${encodeURIComponent(email)}`);
  });

  return (
    <form onSubmit={onSubmit} noValidate method="post" className="grid gap-4">
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
          inputMode="email"
          autoComplete="email"
          aria-invalid={!!errors.email}
          aria-describedby={errors.email ? 'email-error' : undefined}
          {...form.register('email')}
        />
      </Field>
      <div className="grid gap-2">
        <Field id="password" label="Senha" error={errors.password?.message}>
          <PasswordInput
            id="password"
            autoComplete="new-password"
            aria-invalid={!!errors.password}
            aria-describedby={errors.password ? 'password-error password-rules' : 'password-rules'}
            {...form.register('password')}
          />
        </Field>
        <PasswordStrengthMeter password={password} id="password-rules" />
      </div>
      <div className="grid gap-2">
        <Field id="confirm" label="Confirme a senha" error={errors.confirm?.message}>
          <PasswordInput
            id="confirm"
            autoComplete="new-password"
            aria-invalid={!!errors.confirm}
            aria-describedby={errors.confirm ? 'confirm-error' : undefined}
            {...form.register('confirm')}
          />
        </Field>
        {errors.confirm ? null : <PasswordMatch password={password} confirm={confirm} />}
      </div>
      <Button type="submit" variant="brand" disabled={isSubmitting || !ready}>
        {isSubmitting ? <Loader2 className="animate-spin" /> : null}
        Criar conta
      </Button>
      {!ready && password ? (
        <p className="-mt-2 text-center text-muted-foreground text-xs">
          Complete os requisitos da senha e confirme-a para continuar.
        </p>
      ) : null}
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
