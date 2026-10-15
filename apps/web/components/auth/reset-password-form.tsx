'use client';

import { resetPasswordSchema } from '@fusai/shared';
import { Button } from '@fusai/ui/components/button';
import { Input } from '@fusai/ui/components/input';
import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2 } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';
import { Field, FormAlert } from '@/components/form-field';
import { authClient, authErrorMessage } from '@/lib/auth-client';

type Values = z.input<typeof resetPasswordSchema>;

export function ResetPasswordForm({ token }: { token: string }) {
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const form = useForm<Values>({ resolver: zodResolver(resetPasswordSchema) });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async ({ password }) => {
    setError(null);
    const { error } = await authClient.resetPassword({ newPassword: password, token });
    if (error) return setError(authErrorMessage(error));
    setDone(true);
  });

  if (done) {
    return (
      <div className="grid gap-4">
        <FormAlert tone="success">Senha alterada. Entre com a nova senha.</FormAlert>
        <Button asChild variant="brand">
          <Link href="/entrar">Entrar</Link>
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-4">
      {error ? <FormAlert>{error}</FormAlert> : null}
      <Field id="password" label="Nova senha" error={errors.password?.message}>
        <Input
          id="password"
          type="password"
          autoComplete="new-password"
          aria-invalid={!!errors.password}
          aria-describedby={errors.password ? 'password-error' : undefined}
          {...form.register('password')}
        />
      </Field>
      <Field id="confirm" label="Confirme a nova senha" error={errors.confirm?.message}>
        <Input
          id="confirm"
          type="password"
          autoComplete="new-password"
          aria-invalid={!!errors.confirm}
          aria-describedby={errors.confirm ? 'confirm-error' : undefined}
          {...form.register('confirm')}
        />
      </Field>
      <Button type="submit" variant="brand" disabled={isSubmitting}>
        {isSubmitting ? <Loader2 className="animate-spin" /> : null}
        Salvar nova senha
      </Button>
    </form>
  );
}
