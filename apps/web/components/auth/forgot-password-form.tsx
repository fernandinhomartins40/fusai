'use client';

import { forgotPasswordSchema } from '@fusai/shared';
import { Button } from '@fusai/ui/components/button';
import { Input } from '@fusai/ui/components/input';
import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';
import { StatusPanel } from '@/components/auth/status-panel';
import { Field, FormAlert } from '@/components/form-field';
import { authClient, authErrorMessage } from '@/lib/auth-client';

type Values = z.input<typeof forgotPasswordSchema>;

export function ForgotPasswordForm() {
  const [status, setStatus] = useState<{ tone: 'error' | 'success'; text: string } | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const form = useForm<Values>({ resolver: zodResolver(forgotPasswordSchema) });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async ({ email }) => {
    setStatus(null);
    const { error } = await authClient.requestPasswordReset({
      email,
      redirectTo: `${window.location.origin}/redefinir-senha`,
    });
    if (error) return setStatus({ tone: 'error', text: authErrorMessage(error) });
    // Same answer whether or not the email exists (no account enumeration).
    setSentTo(email);
  });

  if (sentTo) {
    return (
      <StatusPanel
        tone="info"
        actions={
          <Button variant="outline" onClick={() => setSentTo(null)}>
            Enviar para outro email
          </Button>
        }
      >
        <p className="font-medium text-base text-foreground">Confira seu email</p>
        <p>
          Se existir uma conta com <strong className="text-foreground">{sentTo}</strong>, você vai
          receber um link para criar uma nova senha. Ele vale por 1 hora. Confira também o spam.
        </p>
      </StatusPanel>
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-4">
      {status ? <FormAlert tone={status.tone}>{status.text}</FormAlert> : null}
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
      <Button type="submit" variant="brand" disabled={isSubmitting}>
        {isSubmitting ? <Loader2 className="animate-spin" /> : null}
        Enviar link
      </Button>
    </form>
  );
}
