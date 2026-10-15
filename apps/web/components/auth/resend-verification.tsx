'use client';

import { Button } from '@fusai/ui/components/button';
import { Input } from '@fusai/ui/components/input';
import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import { Field, FormAlert } from '@/components/form-field';
import { authClient, authErrorMessage } from '@/lib/auth-client';

export function ResendVerification({ defaultEmail = '' }: { defaultEmail?: string }) {
  const [email, setEmail] = useState(defaultEmail);
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState<{ tone: 'error' | 'success'; text: string } | null>(null);

  async function resend(event: React.FormEvent) {
    event.preventDefault();
    if (!email) return;
    setPending(true);
    setStatus(null);
    const { error } = await authClient.sendVerificationEmail({
      email,
      callbackURL: `${window.location.origin}/verificar-email?confirmado=1`,
    });
    setPending(false);
    setStatus(
      error
        ? { tone: 'error', text: authErrorMessage(error) }
        : {
            tone: 'success',
            text: 'Enviamos um novo link. Confira sua caixa de entrada e o spam.',
          },
    );
  }

  return (
    <form onSubmit={resend} className="grid gap-4">
      {status ? <FormAlert tone={status.tone}>{status.text}</FormAlert> : null}
      <Field id="email" label="Email">
        <Input
          id="email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
      </Field>
      <Button type="submit" variant="outline" disabled={pending || !email}>
        {pending ? <Loader2 className="animate-spin" /> : null}
        Reenviar link de confirmação
      </Button>
    </form>
  );
}
