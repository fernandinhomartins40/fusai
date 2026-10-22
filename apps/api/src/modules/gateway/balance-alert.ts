import type { PrismaClient } from '@fusai/db';
import { formatBRL } from '@fusai/shared';
import { lowBalanceEmail } from '../../lib/email-templates';
import type { Mailer } from '../../lib/mailer';

/** E-mails owners and billing members that the org wallet is low or ran out (O-06, best effort). */
export async function emailLowBalance(
  prisma: PrismaClient,
  mailer: Mailer,
  appUrl: string,
  orgId: string,
  available: bigint,
  threshold: bigint,
  empty: boolean,
) {
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    include: {
      members: {
        where: { role: { in: ['OWNER', 'BILLING'] } },
        include: { user: { select: { email: true } } },
      },
    },
  });
  if (!org) return;
  const url = `${appUrl}/app/carteira?recarga=1`;
  await Promise.allSettled(
    org.members.map((m) =>
      mailer.send(
        lowBalanceEmail(
          m.user.email,
          org.name,
          formatBRL(available > 0n ? available : 0n),
          formatBRL(threshold),
          empty,
          url,
        ),
      ),
    ),
  );
}
