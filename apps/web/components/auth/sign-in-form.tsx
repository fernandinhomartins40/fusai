'use client';

import { signInSchema } from '@fusai/shared';
import { Button } from '@fusai/ui/components/button';
import { Input } from '@fusai/ui/components/input';
import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';
import { PasswordInput } from '@/components/auth/password-input';
import { Field, FormAlert } from '@/components/form-field';
import { authClient, authErrorMessage } from '@/lib/auth-client';
import { safeNext } from '@/lib/safe-redirect';

type Values = z.input<typeof signInSchema>;

/** Only the email and the user's choices are stored, never the password (that is the browser's job). */
const STORE = { email: 'fusai:login-email', keep: 'fusai:keep-signed-in' };
const read = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null; // private mode / storage blocked
  }
};
const write = (k: string, v: string | null) => {
  try {
    if (v === null) localStorage.removeItem(k);
    else localStorage.setItem(k, v);
  } catch {}
};

/**
 * Asks the browser to save the credentials. Chrome, Edge, Opera and Brave support the
 * Credential Management API; Firefox and Safari detect the login from the standard
 * autocomplete attributes (username + current-password) instead.
 */
async function offerToSavePassword(email: string, password: string) {
  const PasswordCredentialCtor = (
    window as unknown as { PasswordCredential?: new (d: object) => Credential }
  ).PasswordCredential;
  if (!PasswordCredentialCtor || !navigator.credentials?.store) return;
  try {
    await navigator.credentials.store(
      new PasswordCredentialCtor({ id: email, password, name: email }),
    );
  } catch {}
}

export function SignInForm() {
  const router = useRouter();
  const next = safeNext(useSearchParams().get('next'));
  const [error, setError] = useState<string | null>(null);
  const form = useForm<Values>({
    resolver: zodResolver(signInSchema),
    defaultValues: { email: '', password: '', rememberEmail: false, rememberMe: false },
  });
  const { errors, isSubmitting } = form.formState;

  // Restore the saved email and choices (client only: localStorage).
  useEffect(() => {
    const email = read(STORE.email);
    if (email) {
      form.setValue('email', email);
      form.setValue('rememberEmail', true);
    }
    if (read(STORE.keep) === '1') form.setValue('rememberMe', true);
  }, [form]);

  const onSubmit = form.handleSubmit(async ({ email, password, rememberEmail, rememberMe }) => {
    setError(null);
    const { error } = await authClient.signIn.email({
      email,
      password,
      rememberMe: !!rememberMe,
      callbackURL: `${window.location.origin}/verificar-email?confirmado=1`,
    });
    if (error) return setError(authErrorMessage(error));
    write(STORE.email, rememberEmail ? email : null);
    write(STORE.keep, rememberMe ? '1' : null);
    if (rememberEmail) await offerToSavePassword(email, password);
    router.replace(next);
    router.refresh();
  });

  return (
    <form onSubmit={onSubmit} noValidate method="post" action="/entrar" className="grid gap-4">
      {error ? <FormAlert>{error}</FormAlert> : null}
      <Field id="email" label="Email" error={errors.email?.message}>
        <Input
          id="email"
          type="email"
          inputMode="email"
          autoComplete="username"
          aria-invalid={!!errors.email}
          aria-describedby={errors.email ? 'email-error' : undefined}
          {...form.register('email')}
        />
      </Field>
      <Field id="password" label="Senha" error={errors.password?.message}>
        <PasswordInput
          id="password"
          autoComplete="current-password"
          aria-invalid={!!errors.password}
          aria-describedby={errors.password ? 'password-error' : undefined}
          {...form.register('password')}
        />
      </Field>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-sm">
        <div className="grid gap-2">
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              className="size-4 accent-[var(--fusai-accent)]"
              {...form.register('rememberEmail')}
            />
            Lembrar meu email
          </label>
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              className="size-4 accent-[var(--fusai-accent)]"
              aria-describedby="keep-hint"
              {...form.register('rememberMe')}
            />
            Manter conectado
          </label>
          <span id="keep-hint" className="sr-only">
            Mantém você conectado por 30 dias neste navegador. Não use em computadores
            compartilhados.
          </span>
        </div>
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
