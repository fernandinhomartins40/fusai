import { Button } from '@fusai/ui/components/button';
import type { Metadata } from 'next';
import Link from 'next/link';
import { AuthShell } from '@/components/auth/auth-shell';
import { FormAlert } from '@/components/form-field';
import { AcceptInviteButton } from '@/components/team/accept-invite-button';
import { orgRoleLabel } from '@/lib/admin-labels';
import type { OrgRole } from '@/lib/dashboard-types';
import { getMe, serverApi } from '@/lib/session';

export const metadata: Metadata = { title: 'Convite' };

type Invitation = {
  orgId: string;
  orgName: string;
  email: string;
  role: OrgRole;
  state: 'pending' | 'accepted' | 'revoked' | 'expired';
  emailMatches: boolean;
};

export default async function InvitationPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const me = await getMe();
  const next = encodeURIComponent(`/convite/${token}`);

  if (!me) {
    return (
      <AuthShell
        title="Você foi convidado"
        description="Entre ou crie sua conta com o email que recebeu o convite."
      >
        <div className="grid gap-3">
          <Button asChild variant="brand">
            <Link href={`/entrar?next=${next}`}>Entrar</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href={`/cadastro?next=${next}`}>Criar conta</Link>
          </Button>
        </div>
      </AuthShell>
    );
  }

  const { data: invitation } = await serverApi<Invitation>(
    `/internal/invitations/${encodeURIComponent(token)}`,
  );
  if (!invitation) {
    return (
      <AuthShell title="Convite não encontrado">
        <FormAlert>O link está incorreto ou o convite foi removido.</FormAlert>
      </AuthShell>
    );
  }

  const stateText = {
    accepted: 'Este convite já foi aceito.',
    revoked: 'Este convite foi cancelado.',
    expired: 'Este convite expirou. Peça um novo para quem convidou você.',
  } as const;

  return (
    <AuthShell
      title={`Entrar em ${invitation.orgName}`}
      description={`Papel: ${orgRoleLabel[invitation.role]}. Convite para ${invitation.email}.`}
    >
      {invitation.state !== 'pending' ? (
        <FormAlert>{stateText[invitation.state]}</FormAlert>
      ) : !invitation.emailMatches ? (
        <FormAlert>
          Você entrou como {me.user.email}, mas o convite é para {invitation.email}. Saia e entre
          com a conta certa.
        </FormAlert>
      ) : (
        <AcceptInviteButton token={token} />
      )}
    </AuthShell>
  );
}
