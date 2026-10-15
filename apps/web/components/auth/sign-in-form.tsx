'use client';

import { signInSchema } from '@fusai/shared';
import { Button } from '@fusai/ui/components/button';
import { Input } from '@fusai/ui/components/input';
import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';
import { Field, FormAlert } from '@/components/form-field';
import { authClient, authErrorMessage } from '@/lib/auth-client';
import { safeNext } from '@/lib/safe-redirect';

type Values = z.input<typeof signInSchema>;

export function SignInForm() {
  const router = useRouter();
  const next = safeNext(useSearchParams().get('next'));
  const [error, setError] = useState<string | null>(null);
  const form = useForm<Values>({ resolver: zodResolver(signInSchema) });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    const { error } = await authClient.signIn.email({
      ...values,
      callbackURL: `${window.location.origin}/verificar-email?confirmado=1`,
    });
    if (error) return setError(authErrorMessage(error));
    router.replace(next);
    router.refresh();
  });

  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-4">
      {error ? <FormAlert>{error}</FormAlert> : null}
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
      <Field id="password" label="Senha" error={errors.password?.message}>
        <Input
          id="password"
          type="password"
          autoComplete="current-password"
          aria-invalid={!!errors.password}
          aria-describedby={errors.password ? 'password-error' : undefined}
          {...form.register('password')}
        />
      </Field>
      <div className="-mt-1 text-right text-sm">
        <Link
          href="/recuperar-senha"
          className="text-muted-foreground underline-offset-4 hover:underline"
        >
          Esqueceu a senha?
        </Link>
      </div>
      <Button type="submit" variant="brand" disabled={isSubmitting}>
        {isSubmitting ? <Loader2 className="animate-spin" /> : null}
        Entrar
      </Button>
    </form>
  );
}
