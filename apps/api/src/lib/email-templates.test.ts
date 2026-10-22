import { describe, expect, it } from 'vitest';
import {
  accountDeletionEmail,
  accountLockedEmail,
  invitationEmail,
  lowBalanceEmail,
  mcpSettingsChangedEmail,
  paymentConfirmedEmail,
  resetPasswordEmail,
  verificationEmail,
} from './email-templates';

const evil = '<script>alert(1)</script>';
const url = 'https://www.fusai.com.br/app/carteira';

const all = {
  verification: verificationEmail('a@exemplo.com', evil, url),
  reset: resetPasswordEmail('a@exemplo.com', evil, url),
  invitation: invitationEmail('a@exemplo.com', evil, evil, url),
  payment: paymentConfirmedEmail('a@exemplo.com', evil, 'R$ 10,00', 'R$ 10,00', url),
  lowBalance: lowBalanceEmail('a@exemplo.com', evil, 'R$ 1,00', 'R$ 5,00', false, url),
  empty: lowBalanceEmail('a@exemplo.com', evil, 'R$ 0,00', 'R$ 5,00', true, url),
  deletion: accountDeletionEmail('a@exemplo.com', evil, '29/10/2026', url),
  locked: accountLockedEmail('a@exemplo.com', evil, url),
  mcp: mcpSettingsChangedEmail('a@exemplo.com', evil, ['webhookUrl', 'billingMode'], url),
};

describe('email templates', () => {
  it.each(Object.entries(all))(
    '%s: escapes names, links absolutely and has a text part',
    (_, e) => {
      expect(e.to).toBe('a@exemplo.com');
      expect(e.subject.length).toBeGreaterThan(0);
      expect(e.html).not.toContain('<script>');
      expect(e.html).toContain('lang="pt-BR"');
      expect(e.html).toContain(`href="${url}"`);
      expect(e.html).toContain('https://www.fusai.com.br/brand/logo-fusai.png');
      expect(e.text).toContain(url);
    },
  );

  it('names the changed MCP settings in Portuguese, without values', () => {
    expect(all.mcp.text).toContain('URL do webhook, quem paga o consumo');
  });
});
