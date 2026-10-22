import { randomBytes } from 'node:crypto';
import type { PrismaClient, Project } from '@fusai/db';
import { brlToMicros, endUserPackageSchema, projectUpdateSchema } from '@fusai/shared';
import { encryptSecret } from '../../lib/crypto';
import { deliverWebhook, emitEvent } from '../webhooks-out/service';

/** Shared by the project MCP and the agent MCP: either a result or a pt-BR error message. */
export type ActionResult = { ok: true; data: unknown } | { ok: false; message: string };
const ok = (data: unknown): ActionResult => ({ ok: true, data });
const no = (message: string): ActionResult => ({ ok: false, message });

const MAX_PACKAGES = 20;

/** Reais as text ("9.90" or "9,90") to micros; null when invalid. */
export function parseBrl(value: string): bigint | null {
  try {
    return brlToMicros(value);
  } catch {
    return null;
  }
}

export type PackageArgs = {
  name: string;
  price_brl: string;
  credits_brl: string;
  bonus_brl?: string;
  highlight?: boolean;
};

export function serializePackageForAi(p: {
  id: string;
  name: string;
  priceCents: number;
  creditMicros: bigint;
  bonusMicros: bigint;
  highlight: boolean;
  active: boolean;
}) {
  return {
    id: p.id,
    name: p.name,
    priceCents: p.priceCents,
    creditMicros: p.creditMicros.toString(),
    bonusMicros: p.bonusMicros.toString(),
    highlight: p.highlight,
    active: p.active,
  };
}

export async function createPackage(
  prisma: PrismaClient,
  projectId: string,
  args: PackageArgs,
): Promise<ActionResult> {
  const price = parseBrl(args.price_brl);
  const credit = parseBrl(args.credits_brl);
  const bonus = args.bonus_brl ? parseBrl(args.bonus_brl) : 0n;
  if (price == null || credit == null || bonus == null)
    return no('Valores inválidos. Use reais como texto, ex.: "9.90".');
  if (price % 10_000n !== 0n) return no('O preço precisa estar em centavos inteiros.');
  // R-01: credits ≤ price; the bonus is paid by the organization when the Pix is credited.
  const parsed = endUserPackageSchema.safeParse({
    name: args.name,
    priceCents: Number(price / 10_000n),
    creditMicros: credit.toString(),
    bonusMicros: bonus.toString(),
    highlight: args.highlight ?? false,
    active: true,
    sortOrder: 0,
  });
  if (!parsed.success) return no(parsed.error.issues.map((i) => i.message).join('; '));
  if ((await prisma.creditPackage.count({ where: { projectId } })) >= MAX_PACKAGES)
    return no(`Limite de ${MAX_PACKAGES} pacotes por projeto.`);
  const d = parsed.data;
  const pkg = await prisma.creditPackage.create({
    data: {
      ...d,
      projectId,
      creditMicros: BigInt(d.creditMicros),
      bonusMicros: BigInt(d.bonusMicros),
    },
  });
  return ok(serializePackageForAi(pkg));
}

export type SettingsChanges = {
  allowedOrigins?: string[];
  /** "" removes the webhook. */
  webhookUrl?: string;
  billingMode?: 'ORG_WALLET' | 'END_USER_WALLET' | 'HYBRID';
  /** Free credit for each new end user, in reais as text. */
  free_credit_brl?: string;
};

/**
 * Previews (confirm=false) or applies project settings. A new webhook URL gets its signing
 * secret automatically. Returns the before/after diff either way.
 */
export async function updateProjectSettings(
  prisma: PrismaClient,
  opts: { encryptionKey: Buffer; production: boolean },
  current: Project,
  changes: SettingsChanges,
  confirm: boolean,
): Promise<ActionResult> {
  const freeCredit =
    changes.free_credit_brl !== undefined ? parseBrl(changes.free_credit_brl) : undefined;
  if (freeCredit === null) return no('Crédito grátis inválido. Use reais como texto, ex.: "1.00".');
  const parsed = projectUpdateSchema.safeParse({
    ...(changes.allowedOrigins !== undefined ? { allowedOrigins: changes.allowedOrigins } : {}),
    ...(changes.webhookUrl !== undefined
      ? { webhookUrl: changes.webhookUrl === '' ? null : changes.webhookUrl }
      : {}),
    ...(changes.billingMode !== undefined ? { billingMode: changes.billingMode } : {}),
    ...(freeCredit !== undefined ? { freeCreditMicros: freeCredit.toString() } : {}),
  });
  if (!parsed.success)
    return no(parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
  const { allowedOrigins, webhookUrl, billingMode, freeCreditMicros } = parsed.data;
  const body = Object.fromEntries(
    Object.entries({
      allowedOrigins,
      webhookUrl,
      billingMode,
      freeCreditMicros: freeCreditMicros !== undefined ? BigInt(freeCreditMicros) : undefined,
    }).filter(([, v]) => v !== undefined),
  ) as {
    allowedOrigins?: string[];
    webhookUrl?: string | null;
    billingMode?: Project['billingMode'];
    freeCreditMicros?: bigint;
  };
  if (Object.keys(body).length === 0) return no('Nada para alterar.');
  if (body.webhookUrl && opts.production && !body.webhookUrl.startsWith('https://'))
    return no('O webhook precisa usar https.');
  const show = (v: unknown) => (typeof v === 'bigint' ? v.toString() : v);
  const diff = Object.fromEntries(
    Object.entries(body).map(([k, v]) => [
      k,
      { de: show(current[k as keyof Project]), para: show(v) },
    ]),
  );
  if (!confirm) {
    return ok({
      preview: diff,
      aplicado: false,
      instrucao: 'Confirme com o usuário e chame de novo com confirm: true.',
    });
  }
  await prisma.project.update({
    where: { id: current.id },
    data: {
      ...body,
      ...(body.allowedOrigins ? { allowedOrigins: [...new Set(body.allowedOrigins)] } : {}),
      ...(body.webhookUrl && !current.webhookSecret
        ? {
            webhookSecret: encryptSecret(
              `whsec_${randomBytes(32).toString('base64url')}`,
              opts.encryptionKey,
            ),
          }
        : {}),
    },
  });
  return ok({ aplicado: true, alteracoes: diff });
}

export async function sendTestWebhook(
  prisma: PrismaClient,
  opts: { encryptionKey: Buffer; production: boolean },
  project: Project,
): Promise<ActionResult> {
  if (!project.webhookUrl)
    return no('O projeto não tem URL de webhook. Configure com update_project_settings.');
  const hook = await emitEvent(prisma, project.id, 'test.ping', {
    message: 'Webhook de teste da fusai (MCP)',
  });
  if (!hook) return no('O projeto não tem URL de webhook.');
  await deliverWebhook(prisma, hook.id, opts);
  const after = await prisma.outboundWebhook.findUniqueOrThrow({ where: { id: hook.id } });
  return ok({
    url: project.webhookUrl,
    status: after.status,
    responseStatus: after.responseStatus,
    error: after.lastError,
  });
}
