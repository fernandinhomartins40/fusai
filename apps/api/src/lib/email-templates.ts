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
