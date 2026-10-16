'use client';

import { passwordStrength, resetPasswordSchema } from '@fusai/shared';
import { Button } from '@fusai/ui/components/button';
import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2 } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';
import { PasswordInput } from '@/components/auth/password-input';
import { PasswordMatch, PasswordStrengthMeter } from '@/components/auth/password-strength';
import { StatusPanel } from '@/components/auth/status-panel';
import { Field, FormAlert } from '@/components/form-field';
import { authClient, authErrorMessage } from '@/lib/auth-client';

type Values = z.input<typeof resetPasswordSchema>;

export function ResetPasswordForm({ token }: { token: string }) {
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const form = useForm<Values>({ resolver: zodResolver(resetPasswordSchema), mode: 'onTouched' });
  const { errors, isSubmitting } = form.formState;
  const password = form.watch('password') ?? '';
  const confirm = form.watch('confirm') ?? '';
  const ready = passwordStrength(password).valid && password === confirm;

  const onSubmit = form.handleSubmit(async ({ password }) => {
    setError(null);
    const { error } = await authClient.resetPassword({ newPassword: password, token });
    if (error) return setError(authErrorMessage(error));
    setDone(true);
  });

  if (done) {
    return (
      <StatusPanel
        tone="success"
        actions={
          <Button asChild variant="brand">
            <Link href="/entrar">Entrar com a nova senha</Link>
          </Button>
        }
      >
        <p className="font-medium text-base text-foreground">Senha alterada!</p>
        <p>Por segurança, encerramos as sessões abertas. Entre de novo com a nova senha.</p>
      </StatusPanel>
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-4">
      {error ? <FormAlert>{error}</FormAlert> : null}
      <div className="grid gap-2">
        <Field id="password" label="Nova senha" error={errors.password?.message}>
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
        <Field id="confirm" label="Confirme a nova senha" error={errors.confirm?.message}>
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
        Salvar nova senha
      </Button>
    </form>
  );
}
