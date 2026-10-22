import type { PrismaClient } from '@fusai/db';
import { mcpSettingsChangedEmail } from '../../lib/email-templates';
import type { Mailer } from '../../lib/mailer';

type BillingMode = 'ORG_WALLET' | 'END_USER_WALLET' | 'HYBRID';

/**
 * PIE S-03: keys created by an AI over MCP get only what the integration guide it receives
 * uses (chat, balance/usage, Pix top-up; plus end users in reseller projects), never `mcp`:
 * a key able to drive MCP would let the AI widen its own access. Any other combination is
 * created by a person in the dashboard.
 */
export function mcpKeyScopes(billingMode: BillingMode): string[] {
  const base = ['chat', 'billing:read', 'checkout'];
  return billingMode === 'ORG_WALLET' ? base : [...base, 'app_users'];
}

/** Settings whose change by an AI is emailed to the organization owners. */
export const WATCHED_SETTINGS = ['webhookUrl', 'allowedOrigins', 'billingMode'] as const;
type WatchedSetting = (typeof WATCHED_SETTINGS)[number];

/** Emails every OWNER that an MCP client changed watched settings. Never fails the tool call. */
export async function notifyOwnersOfMcpChange(
  prisma: PrismaClient,
  mailer: Mailer,
  appUrl: string,
  project: { id: string; name: string; orgId: string },
  changes: Record<string, unknown>,
) {
  const fields = WATCHED_SETTINGS.filter((f): f is WatchedSetting => changes[f] !== undefined);
  if (fields.length === 0) return;
  const owners = await prisma.membership.findMany({
    where: { orgId: project.orgId, role: 'OWNER' },
    select: { user: { select: { email: true } } },
  });
  const url = `${appUrl}/app/projetos/${project.id}/configuracoes`;
  await Promise.all(
    owners.map(({ user }) =>
      mailer.send(mcpSettingsChangedEmail(user.email, project.name, fields, url)).catch(() => {}),
    ),
  );
}
