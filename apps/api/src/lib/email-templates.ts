import type { Email } from './mailer';

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function layout(title: string, body: string, cta: { label: string; url: string }): string {
  const url = escapeHtml(cta.url);
  // E-mail exige URL absoluta: o logo vem do mesmo site do link (ex.: https://www.fusai.com.br).
  const logo = escapeHtml(`${new URL(cta.url).origin}/brand/logo-fusai.png`);
  return `<!doctype html><html lang="pt-BR"><body style="margin:0;background:#f6f6f8;font-family:Geist,Arial,sans-serif;color:#18181b">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" style="max-width:480px;background:#fff;border-radius:16px;padding:32px">
<tr><td style="padding-bottom:20px"><img src="${logo}" alt="fusai" width="119" height="28" style="display:block;border:0;height:28px;width:auto"></td></tr>
<tr><td style="font-size:18px;font-weight:600;padding-bottom:8px">${escapeHtml(title)}</td></tr>
<tr><td style="font-size:15px;line-height:1.6;color:#52525b;padding-bottom:24px">${body}</td></tr>
<tr><td><a href="${url}" style="display:inline-block;background:#0066fe;background:linear-gradient(90deg,#162a9e,#0066fe);color:#fff;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:12px">${escapeHtml(cta.label)}</a></td></tr>
<tr><td style="font-size:12px;color:#a1a1aa;padding-top:24px">Se o botão não funcionar, copie e cole este link no navegador:<br>${url}</td></tr>
</table></td></tr></table></body></html>`;
}

export function verificationEmail(to: string, name: string, url: string): Email {
  return {
    to,
    subject: 'Confirme seu email na fusai',
    text: `Olá, ${name}! Confirme seu email para ativar sua conta na fusai:\n\n${url}\n`,
    html: layout(
      'Confirme seu email',
      `Olá, ${escapeHtml(name)}! Clique no botão abaixo para confirmar seu email e ativar sua conta na fusai.`,
      { label: 'Confirmar email', url },
    ),
  };
}

export function resetPasswordEmail(to: string, name: string, url: string): Email {
  return {
    to,
    subject: 'Redefina sua senha da fusai',
    text: `Olá, ${name}! Se você não pediu uma nova senha, ignore este email. Para criar uma nova senha, acesse:\n\n${url}\n`,
    html: layout(
      'Redefinir senha',
      `Olá, ${escapeHtml(name)}! Recebemos um pedido para redefinir sua senha. O link vale por 1 hora. Se você não fez esse pedido, ignore este email.`,
      { label: 'Criar nova senha', url },
    ),
  };
}

export function invitationEmail(to: string, inviter: string, orgName: string, url: string): Email {
  return {
    to,
    subject: `Convite para ${orgName} na fusai`,
    text: `${inviter} convidou você para a organização ${orgName} na fusai. O convite vale por 7 dias:\n\n${url}\n`,
    html: layout(
      `Convite para ${orgName}`,
      `${escapeHtml(inviter)} convidou você para fazer parte de <strong>${escapeHtml(orgName)}</strong> na fusai. O convite vale por 7 dias.`,
      { label: 'Aceitar convite', url },
    ),
  };
}

export function paymentConfirmedEmail(
  to: string,
  orgName: string,
  amount: string,
  credits: string,
  url: string,
): Email {
  return {
    to,
    subject: `Pagamento confirmado: ${credits} em créditos`,
    text: `Recebemos o Pix de ${amount} de ${orgName}. ${credits} em créditos já estão disponíveis.\n\nCarteira: ${url}\n`,
    html: layout(
      'Pagamento confirmado',
      `Recebemos o Pix de <strong>${escapeHtml(amount)}</strong> de ${escapeHtml(orgName)}. <strong>${escapeHtml(credits)}</strong> em créditos já estão disponíveis na sua carteira.`,
      { label: 'Ver carteira', url },
    ),
  };
}

export function lowBalanceEmail(
  to: string,
  orgName: string,
  available: string,
  threshold: string,
  zero: boolean,
  url: string,
): Email {
  const title = zero ? 'Seus créditos acabaram' : 'Saldo baixo na fusai';
  const message = zero
    ? `Os créditos de ${orgName} acabaram. Seus apps param de receber respostas da IA até você recarregar.`
    : `${orgName} tem ${available} disponíveis, abaixo do alerta de ${threshold}. Quando acabar, seus apps param de receber respostas da IA.`;
  return {
    to,
    subject: zero ? `Créditos esgotados em ${orgName}` : `Saldo baixo em ${orgName}: ${available}`,
    text: `${message}\n\nRecarregue com Pix: ${url}\n`,
    html: layout(
      title,
      zero
        ? `Os créditos de <strong>${escapeHtml(orgName)}</strong> acabaram. Seus apps param de receber respostas da IA até você recarregar.`
        : `<strong>${escapeHtml(orgName)}</strong> tem <strong>${escapeHtml(available)}</strong> disponíveis, abaixo do alerta de ${escapeHtml(threshold)}. Quando acabar, seus apps param de receber respostas da IA.`,
      { label: 'Adicionar créditos', url },
    ),
  };
}

export function accountDeletionEmail(to: string, name: string, date: string, url: string): Email {
  return {
    to,
    subject: 'Pedido de exclusão da sua conta na fusai',
    text: `Olá, ${name}! Recebemos o pedido para excluir sua conta na fusai. Ela será anonimizada em ${date}. Até lá você pode cancelar o pedido em:\n\n${url}\n\nSe não foi você, entre agora e cancele o pedido.\n`,
    html: layout(
      'Pedido de exclusão da conta',
      `Olá, ${escapeHtml(name)}! Recebemos o pedido para excluir sua conta na fusai. Ela será anonimizada em <strong>${escapeHtml(date)}</strong>. Até lá você pode cancelar o pedido. Se não foi você, entre agora e cancele.`,
      { label: 'Ver ou cancelar o pedido', url },
    ),
  };
}

/** PIE S-05: sent once when the per-account lock starts (10 wrong passwords in 15 min). */
export function accountLockedEmail(to: string, name: string, url: string): Email {
  return {
    to,
    subject: 'Tentativas de acesso bloqueadas na sua conta da fusai',
    text: `Olá, ${name}! Houve muitas tentativas de senha errada na sua conta da fusai. O login com senha ficou bloqueado por 15 minutos. Se não foi você, troque a senha e ative a verificação em duas etapas:\n\n${url}\n`,
    html: layout(
      'Login bloqueado por 15 minutos',
      `Olá, ${escapeHtml(name)}! Houve muitas tentativas de senha errada na sua conta da fusai, então o login com senha ficou bloqueado por 15 minutos. Se não foi você, troque a senha e ative a verificação em duas etapas.`,
      { label: 'Trocar a senha', url },
    ),
  };
}

const PROJECT_SETTING_LABELS = {
  webhookUrl: 'URL do webhook',
  allowedOrigins: 'origens permitidas',
  billingMode: 'quem paga o consumo',
} as const;

/** PIE S-03: an AI agent (MCP) changed sensitive project settings. Never includes secrets. */
export function mcpSettingsChangedEmail(
  to: string,
  projectName: string,
  fields: (keyof typeof PROJECT_SETTING_LABELS)[],
  url: string,
): Email {
  const changed = fields.map((f) => PROJECT_SETTING_LABELS[f]).join(', ');
  return {
    to,
    subject: `Configurações do projeto ${projectName} alteradas por IA (MCP)`,
    text: `Uma IA conectada por MCP alterou ${changed} do projeto ${projectName}. Se não reconhece a mudança, revise o projeto e revogue a chave usada:\n\n${url}\n`,
    html: layout(
      'Projeto alterado por IA (MCP)',
      `Uma IA conectada por MCP alterou <strong>${escapeHtml(changed)}</strong> do projeto <strong>${escapeHtml(projectName)}</strong>. Se não reconhece a mudança, revise o projeto e revogue a chave usada.`,
      { label: 'Revisar o projeto', url },
    ),
  };
}

/** The daily PTAX rate moved more than 10%: not applied until a super admin confirms. */
export function fxRateRejectedEmail(
  to: string,
  current: string,
  quoted: string,
  url: string,
): Email {
  const brl = (v: string) => v.replace('.', ',');
  return {
    to,
    subject: 'Câmbio do dia não aplicado na fusai (variação acima de 10%)',
    text: `A cotação PTAX do Banco Central (R$ ${brl(quoted)}) difere mais de 10% do câmbio em uso (R$ ${brl(current)}). Por segurança, o preço dos modelos não foi alterado. Confira e, se estiver certo, salve o novo valor em Preços globais:\n\n${url}\n`,
    html: layout(
      'Câmbio do dia não aplicado',
      `A cotação PTAX do Banco Central (<strong>R$ ${escapeHtml(brl(quoted))}</strong>) difere mais de 10% do câmbio em uso (<strong>R$ ${escapeHtml(brl(current))}</strong>). Por segurança, o preço dos modelos não foi alterado. Confira e, se estiver certo, salve o novo valor em Preços globais.`,
      { label: 'Abrir Preços globais', url },
    ),
  };
}

/** PIE V-01: the daily database backup failed or is overdue. Sent to super admins. */
export function backupAlertEmail(to: string, reason: string, url: string): Email {
  return {
    to,
    subject: 'Backup diário da fusai com problema',
    text: `${reason} Confira o contêiner fuseai-backup e o log em /root/fuseai/backups/daily/backup.log na VPS. O procedimento está em docs/OPERACAO.md.

${url}
`,
    html: layout(
      'Backup diário com problema',
      `${escapeHtml(reason)} Confira o contêiner <strong>fuseai-backup</strong> e o log em <code>/root/fuseai/backups/daily/backup.log</code> na VPS. O procedimento está em docs/OPERACAO.md.`,
      { label: 'Abrir o painel admin', url },
    ),
  };
}
