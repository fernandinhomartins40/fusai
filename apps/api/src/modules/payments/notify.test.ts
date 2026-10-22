import { prisma } from '@fusai/db';
import { beforeEach, describe, expect, it } from 'vitest';
import { createFundedOrg, resetDb } from '../../../test/helpers';
import { createMemoryMailer, type Mailer } from '../../lib/mailer';
import { notifyPaymentCredited } from './notify';

describe('payment confirmed email', () => {
  beforeEach(async () => {
    await resetDb();
  });

  async function setup() {
    const { org, walletId } = await createFundedOrg();
    for (const [i, role] of (['OWNER', 'BILLING', 'DEVELOPER'] as const).entries()) {
      const user = await prisma.user.create({
        data: {
          id: `notify-u${i}`,
          name: `Pessoa ${i}`,
          email: `p${i}@exemplo.com`,
          emailVerified: true,
        },
      });
      await prisma.membership.create({ data: { orgId: org.id, userId: user.id, role } });
    }
    const payment = await prisma.payment.create({
      data: {
        walletId,
        orgId: org.id,
        amountCents: 1000,
        creditMicros: 10_000_000n,
        idempotencyKey: 'notify-test',
        status: 'RECEIVED',
      },
    });
    return payment;
  }

  it('emails owners and billing (not developers) with the amount and wallet link', async () => {
    const payment = await setup();
    const mailer = createMemoryMailer();
    await notifyPaymentCredited(prisma, mailer, 'https://www.fusai.com.br', payment);
    expect(mailer.sent.map((m) => m.to).sort()).toEqual(['p0@exemplo.com', 'p1@exemplo.com']);
    expect(mailer.sent[0]?.subject).toContain('Pagamento confirmado');
    expect(mailer.sent[0]?.text).toContain('https://www.fusai.com.br/app/carteira');
  });

  it('does not throw when the email provider fails', async () => {
    const payment = await setup();
    const failing: Mailer = {
      send: async () => {
        throw new Error('VeloMail 503');
      },
    };
    await expect(
      notifyPaymentCredited(prisma, failing, 'https://www.fusai.com.br', payment),
    ).resolves.toBeUndefined();
  });
});
