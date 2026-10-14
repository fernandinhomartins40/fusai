import type { Payment, PrismaClient } from '@fuseai/db';
import { centsToMicros, formatBRL } from '@fuseai/shared';
import { paymentConfirmedEmail } from '../../lib/email-templates';
import type { Mailer } from '../../lib/mailer';

/** E-mails owners, admins and billing members after a top-up is credited (best effort). */
export async function notifyPaymentCredited(
  prisma: PrismaClient,
  mailer: Mailer,
  appUrl: string,
  payment: Payment,
) {
  const org = await prisma.organization.findUnique({
    where: { id: payment.orgId },
    include: {
      members: {
        where: { role: { in: ['OWNER', 'ADMIN', 'BILLING'] } },
        include: { user: { select: { email: true } } },
      },
    },
  });
  if (!org) return;
  const amount = formatBRL(centsToMicros(payment.amountCents));
  const credits = formatBRL(payment.creditMicros);
  await Promise.allSettled(
    org.members.map((m) =>
      mailer.send(
        paymentConfirmedEmail(m.user.email, org.name, amount, credits, `${appUrl}/app/carteira`),
      ),
    ),
  );
}
