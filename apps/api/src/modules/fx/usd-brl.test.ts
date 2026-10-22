import { prisma } from '@fusai/db';
import { DEFAULT_SETTINGS } from '@fusai/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { resetDb } from '../../../test/helpers';
import { createMemoryMailer } from '../../lib/mailer';
import { createSettingsStore } from '../../lib/settings';
import { fetchPtax, PTAX_URL, updateUsdBrlRate } from './usd-brl';

/** Fake BCB: answers like the PTAX OData service and records the requested URLs. */
function fakePtax(rate: number | null, status = 200) {
  const calls: URL[] = [];
  const impl = (async (input: string | URL | Request) => {
    calls.push(new URL(String(input)));
    const value =
      rate === null ? [] : [{ cotacaoVenda: rate, dataHoraCotacao: '2026-10-22 13:09:33.912' }];
    return new Response(JSON.stringify({ value }), { status });
  }) as typeof fetch;
  return { impl, calls };
}

describe('USD→BRL rate from PTAX', () => {
  const mailer = createMemoryMailer();
  const settings = createSettingsStore(prisma);
  const deps = (rate: number | null, status = 200) => {
    const fake = fakePtax(rate, status);
    return {
      fake,
      deps: { prisma, settings, mailer, appUrl: 'http://localhost:3000', fetchImpl: fake.impl },
    };
  };

  beforeEach(async () => {
    await resetDb();
    settings.invalidate();
    mailer.sent.length = 0;
    await settings.save({ ...DEFAULT_SETTINGS, usd_brl_rate: '5.50' });
  });

  it('asks only the BCB host for the latest quote of a 10-day window', async () => {
    const { fake } = deps(5.4321);
    const quote = await fetchPtax(fake.impl, new Date('2026-10-22T18:00:00Z'));
    expect(quote).toEqual({ rate: '5.4321', quotedAt: '2026-10-22 13:09:33.912' });
    const url = fake.calls[0];
    if (!url) throw new Error('PTAX not called');
    expect(url.origin + url.pathname).toBe(PTAX_URL);
    expect(url?.searchParams.get('@dataInicial')).toBe("'10-12-2026'");
    expect(url?.searchParams.get('@dataFinalCotacao')).toBe("'10-22-2026'");
    expect(url?.searchParams.get('$top')).toBe('1');
    // The real service answers 400 when the space is sent as "+".
    expect(url?.search).toContain('dataHoraCotacao%20desc');
    expect(url?.search).not.toContain('+');
  });

  it('applies a normal daily move and records it in the audit log', async () => {
    const { deps: d } = deps(5.6123);
    const result = await updateUsdBrlRate(d);
    expect(result).toMatchObject({ status: 'updated', from: '5.50', to: '5.6123' });
    settings.invalidate();
    expect((await settings.get()).usd_brl_rate).toBe('5.6123');
    const log = await prisma.auditLog.findFirstOrThrow({ where: { action: 'settings.fx_auto' } });
    expect(log.metadata).toMatchObject({ from: '5.50', to: '5.6123' });
    expect(mailer.sent).toHaveLength(0);
  });

  it('does nothing when the admin locked the rate', async () => {
    await settings.save({ ...(await settings.get()), usd_brl_auto: 'false' });
    const { fake, deps: d } = deps(5.6123);
    expect(await updateUsdBrlRate(d)).toEqual({ status: 'locked' });
    expect(fake.calls).toHaveLength(0);
    expect((await settings.get()).usd_brl_rate).toBe('5.50');
  });

  it('keeps the rate on a move above 10% and emails super admins once a day', async () => {
    await prisma.user.createMany({
      data: [
        { id: 'adm', name: 'Admin', email: 'admin@fusai.test', role: 'SUPER_ADMIN' },
        { id: 'ban', name: 'Banido', email: 'ban@fusai.test', role: 'SUPER_ADMIN', banned: true },
        { id: 'usr', name: 'Cliente', email: 'cliente@fusai.test' },
      ],
    });
    const { deps: d } = deps(6.2);
    const first = await updateUsdBrlRate(d);
    expect(first).toMatchObject({
      status: 'rejected',
      current: '5.50',
      quoted: '6.2000',
      alerted: true,
    });
    settings.invalidate();
    expect((await settings.get()).usd_brl_rate).toBe('5.50');
    expect(mailer.sent.map((m) => m.to)).toEqual(['admin@fusai.test']);
    expect(mailer.sent[0]?.subject).toContain('Câmbio do dia não aplicado');

    const second = await updateUsdBrlRate(d);
    expect(second).toMatchObject({ status: 'rejected', alerted: false });
    expect(mailer.sent).toHaveLength(1);
  });

  it('fails without touching the rate when the BCB answers an error or no quote', async () => {
    await expect(updateUsdBrlRate(deps(null).deps)).rejects.toThrow('PTAX sem cotação válida');
    await expect(updateUsdBrlRate(deps(5.6, 503).deps)).rejects.toThrow('PTAX respondeu 503');
    await expect(updateUsdBrlRate(deps(-1).deps)).rejects.toThrow('PTAX sem cotação válida');
    settings.invalidate();
    expect((await settings.get()).usd_brl_rate).toBe('5.50');
  });
});
