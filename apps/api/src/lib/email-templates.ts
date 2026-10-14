import type { Email } from './mailer';

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function layout(title: string, body: string, cta: { label: string; url: string }): string {
  const url = escapeHtml(cta.url);
  return `<!doctype html><html lang="pt-BR"><body style="margin:0;background:#f6f6f8;font-family:Geist,Arial,sans-serif;color:#18181b">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" style="max-width:480px;background:#fff;border-radius:16px;padding:32px">
<tr><td style="font-size:22px;font-weight:600;padding-bottom:16px">fuse<span style="color:#ec4899">ai</span></td></tr>
<tr><td style="font-size:18px;font-weight:600;padding-bottom:8px">${escapeHtml(title)}</td></tr>
<tr><td style="font-size:15px;line-height:1.6;color:#52525b;padding-bottom:24px">${body}</td></tr>
<tr><td><a href="${url}" style="display:inline-block;background:linear-gradient(90deg,#f59e0b,#ec4899,#8b5cf6);color:#fff;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:12px">${escapeHtml(cta.label)}</a></td></tr>
<tr><td style="font-size:12px;color:#a1a1aa;padding-top:24px">Se o botão não funcionar, copie e cole este link no navegador:<br>${url}</td></tr>
</table></td></tr></table></body></html>`;
}

export function verificationEmail(to: string, name: string, url: string): Email {
  return {
    to,
    subject: 'Confirme seu email na FuseAI',
    text: `Olá, ${name}! Confirme seu email para ativar sua conta na FuseAI:\n\n${url}\n`,
    html: layout(
      'Confirme seu email',
      `Olá, ${escapeHtml(name)}! Clique no botão abaixo para confirmar seu email e ativar sua conta na FuseAI.`,
      { label: 'Confirmar email', url },
    ),
  };
}

export function resetPasswordEmail(to: string, name: string, url: string): Email {
  return {
    to,
    subject: 'Redefina sua senha da FuseAI',
    text: `Olá, ${name}! Se você não pediu uma nova senha, ignore este email. Para criar uma nova senha, acesse:\n\n${url}\n`,
    html: layout(
      'Redefinir senha',
      `Olá, ${escapeHtml(name)}! Recebemos um pedido para redefinir sua senha. O link vale por 1 hora. Se você não fez esse pedido, ignore este email.`,
      { label: 'Criar nova senha', url },
    ),
  };
}
