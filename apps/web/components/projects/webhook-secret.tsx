'use client';

import { Button } from '@fusai/ui/components/button';
import { Eye, EyeOff, Loader2, RotateCw } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { confirmAction } from '@/components/confirm';
import { CopyButton } from '@/components/copy-button';
import { ApiError, apiFetch } from '@/lib/api';

/** Webhook signing secret: hidden by default, revealable and rotatable (PRD §11.4 Webhooks). */
export function WebhookSecret({ projectId, hasSecret }: { projectId: string; hasSecret: boolean }) {
  const [secret, setSecret] = useState<string | null>(null);
  const [exists, setExists] = useState(hasSecret);
  const [pending, setPending] = useState(false);

  async function run(action: 'reveal' | 'rotate') {
    if (
      action === 'rotate' &&
      exists &&
      !(await confirmAction('Gerar um novo segredo? O atual para de valer imediatamente.', {
        confirmLabel: 'Gerar novo',
        destructive: true,
      }))
    )
      return;
    setPending(true);
    try {
      const res = await apiFetch<{ secret: string | null }>(
        action === 'reveal'
          ? `/internal/projects/${projectId}/webhook-secret`
          : `/internal/projects/${projectId}/webhook-secret/rotate`,
        action === 'rotate' ? { method: 'POST' } : {},
      );
      setSecret(res.secret);
      if (action === 'rotate') {
        setExists(true);
        toast.success('Novo segredo gerado');
      }
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Não foi possível concluir.');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-xl border bg-muted/40 px-3 py-2 font-mono text-xs">
          {secret ?? (exists ? 'whsec_••••••••••••••••••••' : 'Nenhum segredo gerado')}
        </code>
        {secret ? <CopyButton value={secret} /> : null}
        {exists ? (
          <Button
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={() => (secret ? setSecret(null) : run('reveal'))}
          >
            {secret ? <EyeOff /> : <Eye />}
            {secret ? 'Ocultar' : 'Revelar'}
          </Button>
        ) : null}
        <Button variant="outline" size="sm" disabled={pending} onClick={() => run('rotate')}>
          {pending ? <Loader2 className="animate-spin" /> : <RotateCw />}
          {exists ? 'Rotacionar' : 'Gerar segredo'}
        </Button>
      </div>
      <p className="text-muted-foreground text-xs">
        Cada entrega leva o header <code className="font-mono">X-Fuse-Signature: t=…,v1=…</code>{' '}
        (HMAC-SHA256 de <code className="font-mono">t + "." + corpo</code>) para você validar que
        veio da fusai.
      </p>
    </div>
  );
}
