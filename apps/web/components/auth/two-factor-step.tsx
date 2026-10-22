'use client';

import { Button } from '@fusai/ui/components/button';
import { Input } from '@fusai/ui/components/input';
import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import { Field, FormAlert } from '@/components/form-field';
import { authClient, authErrorMessage } from '@/lib/auth-client';

/**
 * Second step of the sign-in (or a confirmation while signed in): the 6-digit code from the
 * authenticator app, or a one-time recovery code when the phone is not at hand.
 */
export function TwoFactorStep({
  onDone,
  onCancel,
  submitLabel = 'Confirmar',
}: {
  onDone: () => void;
  onCancel?: () => void;
  submitLabel?: string;
}) {
  const [backup, setBackup] = useState(false);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const value = code.trim();
    if (!backup && !/^\d{6}$/.test(value)) return setError('Digite os 6 números do app.');
    if (backup && value.length < 4) return setError('Digite o código de recuperação.');
    setBusy(true);
    const { error } = backup
      ? await authClient.twoFactor.verifyBackupCode({ code: value })
      : await authClient.twoFactor.verifyTotp({ code: value });
    setBusy(false);
    if (error) return setError(authErrorMessage(error));
    onDone();
  }

  return (
    <form onSubmit={submit} noValidate className="grid gap-4">
      {error ? <FormAlert>{error}</FormAlert> : null}
      <Field
        id="mfa-code"
        label={backup ? 'Código de recuperação' : 'Código do app autenticador'}
        hint={
          backup
            ? 'Cada código de recuperação funciona uma única vez.'
            : 'Abra o app autenticador (Google Authenticator, Authy, 1Password…) e digite o código da fusai.'
        }
      >
        <Input
          id="mfa-code"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          inputMode={backup ? 'text' : 'numeric'}
          autoComplete="one-time-code"
          maxLength={backup ? 32 : 6}
          autoFocus
          className={backup ? 'font-mono' : 'font-mono tracking-[0.4em]'}
        />
      </Field>
      <Button type="submit" variant="brand" disabled={busy}>
        {busy ? <Loader2 className="animate-spin" /> : null}
        {submitLabel}
      </Button>
      <div className="flex flex-wrap justify-between gap-2 text-sm">
        <button
          type="button"
          className="text-muted-foreground underline-offset-4 hover:underline"
          onClick={() => {
            setBackup(!backup);
            setCode('');
            setError(null);
          }}
        >
          {backup ? 'Usar o app autenticador' : 'Usar um código de recuperação'}
        </button>
        {onCancel ? (
          <button
            type="button"
            className="text-muted-foreground underline-offset-4 hover:underline"
            onClick={onCancel}
          >
            Voltar
          </button>
        ) : null}
      </div>
    </form>
  );
}
