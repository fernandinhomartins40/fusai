'use client';

import { Button } from '@fusai/ui/components/button';
import { Input } from '@fusai/ui/components/input';
import { Copy, Download, Loader2, ShieldCheck } from 'lucide-react';
import { useRouter } from 'next/navigation';
import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { PasswordInput } from '@/components/auth/password-input';
import { TwoFactorStep } from '@/components/auth/two-factor-step';
import { Field, FormAlert } from '@/components/form-field';
import { authClient, authErrorMessage } from '@/lib/auth-client';

type Enrollment = { totpURI: string; backupCodes: string[] };

/** Base32 secret from the otpauth URI, for typing it by hand when the QR cannot be scanned. */
const secretOf = (uri: string) => new URL(uri).searchParams.get('secret') ?? '';

function downloadCodes(codes: string[]) {
  const text = `Códigos de recuperação da fusai (cada um vale uma vez):\n\n${codes.join('\n')}\n`;
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
  const a = Object.assign(document.createElement('a'), {
    href: url,
    download: 'fusai-codigos.txt',
  });
  a.click();
  URL.revokeObjectURL(url);
}

function BackupCodes({ codes }: { codes: string[] }) {
  return (
    <div className="grid gap-3">
      <p className="text-sm">
        Guarde estes <strong>códigos de recuperação</strong> num lugar seguro. Cada um entra uma vez
        se você perder o celular. Eles não aparecem de novo.
      </p>
      <ul className="grid grid-cols-2 gap-2 rounded-xl border bg-muted/40 p-3 font-mono text-sm">
        {codes.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() =>
            navigator.clipboard
              .writeText(codes.join('\n'))
              .then(() => toast.success('Códigos copiados'))
          }
        >
          <Copy /> Copiar
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={() => downloadCodes(codes)}>
          <Download /> Baixar .txt
        </Button>
      </div>
    </div>
  );
}

/** Asks the password again before changing the second factor. */
function PasswordForm({
  label,
  busy,
  onSubmit,
  destructive,
}: {
  label: string;
  busy: boolean;
  onSubmit: (password: string) => void;
  destructive?: boolean;
}) {
  const [password, setPassword] = useState('');
  return (
    <form
      noValidate
      className="grid gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (password) onSubmit(password);
      }}
    >
      <Field id="mfa-password" label="Sua senha" hint="Confirmamos que é você antes da mudança.">
        <PasswordInput
          id="mfa-password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </Field>
      <Button
        type="submit"
        variant={destructive ? 'destructive' : 'brand'}
        disabled={busy || !password}
        className="justify-self-start"
      >
        {busy ? <Loader2 className="animate-spin" /> : null}
        {label}
      </Button>
    </form>
  );
}

/**
 * Turn the authenticator app (TOTP) on or off. `required` (super admin) hides "desativar" and
 * calls `onVerified` once the first code is confirmed.
 */
export function TwoFactorSetup({
  enabled,
  required = false,
  onVerified,
}: {
  enabled: boolean;
  required?: boolean;
  onVerified?: () => void;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<'idle' | 'enable' | 'disable' | 'codes'>('idle');
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [newCodes, setNewCodes] = useState<string[] | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enrollment) return setQr(null);
    QRCode.toDataURL(enrollment.totpURI, { margin: 1, width: 192 })
      .then(setQr)
      .catch(() => setQr(null));
  }, [enrollment]);

  async function start(password: string) {
    setBusy(true);
    setError(null);
    const { data, error } = await authClient.twoFactor.enable({ password, issuer: 'fusai' });
    setBusy(false);
    if (error || !data) return setError(authErrorMessage(error));
    setEnrollment(data as Enrollment);
  }

  async function disable(password: string) {
    setBusy(true);
    setError(null);
    const { error } = await authClient.twoFactor.disable({ password });
    setBusy(false);
    if (error) return setError(authErrorMessage(error));
    toast.success('Verificação em duas etapas desativada');
    setMode('idle');
    router.refresh();
  }

  async function regenerate(password: string) {
    setBusy(true);
    setError(null);
    const { data, error } = await authClient.twoFactor.generateBackupCodes({ password });
    setBusy(false);
    if (error || !data) return setError(authErrorMessage(error));
    setNewCodes((data as { backupCodes: string[] }).backupCodes);
  }

  if (enabled && mode === 'idle')
    return (
      <div className="grid gap-4">
        <p className="flex items-center gap-2 text-sm">
          <ShieldCheck className="size-4 text-success-foreground" aria-hidden />
          Ativa: ao entrar com senha, pedimos o código do app autenticador.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => setMode('codes')}>
            Gerar novos códigos de recuperação
          </Button>
          {required ? null : (
            <Button type="button" variant="outline" size="sm" onClick={() => setMode('disable')}>
              Desativar
            </Button>
          )}
        </div>
      </div>
    );

  if (enabled && mode === 'codes')
    return (
      <div className="grid gap-4">
        {error ? <FormAlert>{error}</FormAlert> : null}
        {newCodes ? (
          <>
            <BackupCodes codes={newCodes} />
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="justify-self-start"
              onClick={() => {
                setNewCodes(null);
                setMode('idle');
              }}
            >
              Pronto
            </Button>
          </>
        ) : (
          <PasswordForm label="Gerar novos códigos" busy={busy} onSubmit={regenerate} />
        )}
      </div>
    );

  if (enabled && mode === 'disable')
    return (
      <div className="grid gap-4">
        {error ? <FormAlert>{error}</FormAlert> : null}
        <p className="text-muted-foreground text-sm">
          Sem a verificação em duas etapas, só a senha protege sua conta.
        </p>
        <PasswordForm label="Desativar" destructive busy={busy} onSubmit={disable} />
        <button
          type="button"
          className="justify-self-start text-muted-foreground text-sm underline-offset-4 hover:underline"
          onClick={() => setMode('idle')}
        >
          Cancelar
        </button>
      </div>
    );

  if (!enrollment)
    return (
      <div className="grid gap-4">
        {error ? <FormAlert>{error}</FormAlert> : null}
        <p className="text-muted-foreground text-sm">
          {required
            ? 'O painel admin exige a verificação em duas etapas. Instale um app autenticador (Google Authenticator, Authy, 1Password…) e ative abaixo.'
            : 'Além da senha, peça um código do app autenticador do seu celular ao entrar.'}
        </p>
        {mode === 'enable' || required ? (
          <PasswordForm label="Continuar" busy={busy} onSubmit={start} />
        ) : (
          <Button
            type="button"
            variant="brand"
            className="justify-self-start"
            onClick={() => setMode('enable')}
          >
            Ativar verificação em duas etapas
          </Button>
        )}
      </div>
    );

  return (
    <div className="grid gap-6">
      <div className="grid gap-3">
        <p className="text-sm">1. No app autenticador, escaneie o QR code ou digite a chave.</p>
        <div className="flex flex-wrap items-center gap-4">
          {qr ? (
            // biome-ignore lint/performance/noImgElement: data URL generated in the browser
            <img
              src={qr}
              alt="QR code para o app autenticador"
              width={192}
              height={192}
              className="rounded-lg border bg-white p-1"
            />
          ) : null}
          <div className="grid min-w-0 gap-1">
            <span className="text-muted-foreground text-xs">Chave para digitar</span>
            <Input
              readOnly
              value={secretOf(enrollment.totpURI)}
              className="font-mono text-xs"
              aria-label="Chave para digitar no app autenticador"
              onFocus={(e) => e.currentTarget.select()}
            />
          </div>
        </div>
      </div>
      <BackupCodes codes={enrollment.backupCodes} />
      <div className="grid gap-3">
        <p className="text-sm">2. Digite o código de 6 números que o app mostra.</p>
        <TwoFactorStep
          submitLabel="Ativar"
          onDone={() => {
            toast.success('Verificação em duas etapas ativada');
            setEnrollment(null);
            setMode('idle');
            if (onVerified) onVerified();
            else router.refresh();
          }}
        />
      </div>
    </div>
  );
}
