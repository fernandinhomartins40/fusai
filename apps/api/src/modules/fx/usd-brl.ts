import type { PrismaClient } from '@fusai/db';
import { fxRateRejectedEmail } from '../../lib/email-templates';
import type { Mailer } from '../../lib/mailer';
import type { SettingsStore } from '../../lib/settings';

/** Banco Central do Brasil, PTAX (public, no key). Only this fixed host is ever called. */
export const PTAX_URL =
  'https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/CotacaoDolarPeriodo(dataInicial=@dataInicial,dataFinalCotacao=@dataFinalCotacao)';

/** A daily move above this is far beyond normal FX volatility: kept for a human to confirm. */
const MAX_CHANGE = 0.1;
const DAY_MS = 24 * 60 * 60 * 1000;

export type PtaxQuote = { rate: string; quotedAt: string };

export type FxResult =
  | { status: 'locked' }
  | { status: 'unchanged'; rate: string; quotedAt: string }
  | { status: 'updated'; from: string; to: string; quotedAt: string }
  | { status: 'rejected'; current: string; quoted: string; quotedAt: string; alerted: boolean };

/** MM-DD-YYYY in Brasília, the format the PTAX OData service expects. */
function ptaxDate(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('month')}-${get('day')}-${get('year')}`;
}

/**
 * Latest PTAX selling rate. The 10-day window covers weekends and holidays: the newest quote
 * is the last business day's when today has none yet.
 */
export async function fetchPtax(fetchImpl: typeof fetch = fetch, now = new Date()) {
  // Built by hand: URLSearchParams writes spaces as "+", which the OData service rejects (400).
  const query = Object.entries({
    '@dataInicial': `'${ptaxDate(new Date(now.getTime() - 10 * DAY_MS))}'`,
    '@dataFinalCotacao': `'${ptaxDate(now)}'`,
    $format: 'json',
    $orderby: 'dataHoraCotacao desc',
    $top: '1',
  })
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&');
  const res = await fetchImpl(`${PTAX_URL}?${query}`, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`PTAX respondeu ${res.status}`);
  const body = (await res.json()) as {
    value?: { cotacaoVenda?: unknown; dataHoraCotacao?: unknown }[];
  };
  const quote = body.value?.[0];
  const rate = Number(quote?.cotacaoVenda);
  if (!quote || !Number.isFinite(rate) || rate <= 0) throw new Error('PTAX sem cotação válida');
  return { rate: rate.toFixed(4), quotedAt: String(quote.dataHoraCotacao) } satisfies PtaxQuote;
}

/**
 * Daily job: applies the PTAX rate to `usd_brl_rate` unless the admin locked it
 * (`usd_brl_auto` = "false"). A change above ±10% is not applied; super admins get one
 * email per day about it.
 */
export async function updateUsdBrlRate(
  deps: {
    prisma: PrismaClient;
    settings: SettingsStore;
    mailer: Mailer;
    appUrl: string;
    fetchImpl?: typeof fetch;
  },
  now = new Date(),
): Promise<FxResult> {
  const { prisma, settings, mailer } = deps;
  const current = await settings.get();
  if (current.usd_brl_auto !== 'true') return { status: 'locked' };

  const quote = await fetchPtax(deps.fetchImpl, now);
  const from = Number(current.usd_brl_rate);
  const to = Number(quote.rate);
  if (from === to)
    return { status: 'unchanged', rate: current.usd_brl_rate, quotedAt: quote.quotedAt };

  if (Math.abs(to - from) / from > MAX_CHANGE) {
    const recent = await prisma.auditLog.count({
      where: {
        action: 'settings.fx_rejected',
        createdAt: { gte: new Date(now.getTime() - DAY_MS) },
      },
    });
    await prisma.auditLog.create({
      data: {
        actorId: null,
        action: 'settings.fx_rejected',
        target: 'usd_brl_rate',
        metadata: { current: current.usd_brl_rate, quoted: quote.rate, quotedAt: quote.quotedAt },
      },
    });
    if (recent === 0) {
      const admins = await prisma.user.findMany({
        where: { role: 'SUPER_ADMIN', OR: [{ banned: false }, { banned: null }] },
        select: { email: true },
      });
      const url = `${deps.appUrl}/admin/precos`;
      for (const admin of admins) {
        await mailer
          .send(fxRateRejectedEmail(admin.email, current.usd_brl_rate, quote.rate, url))
          .catch(() => {});
      }
    }
    return {
      status: 'rejected',
      current: current.usd_brl_rate,
      quoted: quote.rate,
      quotedAt: quote.quotedAt,
      alerted: recent === 0,
    };
  }

  await settings.save({ ...current, usd_brl_rate: quote.rate });
  await prisma.auditLog.create({
    data: {
      actorId: null,
      action: 'settings.fx_auto',
      target: 'usd_brl_rate',
      metadata: { from: current.usd_brl_rate, to: quote.rate, quotedAt: quote.quotedAt },
    },
  });
  return {
    status: 'updated',
    from: current.usd_brl_rate,
    to: quote.rate,
    quotedAt: quote.quotedAt,
  };
}
