import type { PrismaClient } from '@fuseai/db';

/** Reads an integer setting stored as a JSON string or number (e.g. micros). */
export async function getBigIntSetting(
  prisma: PrismaClient,
  key: string,
  fallback: bigint,
): Promise<bigint> {
  const row = await prisma.setting.findUnique({ where: { key } });
  if (row == null) return fallback;
  const value = row.value;
  if (typeof value === 'number' && Number.isInteger(value)) return BigInt(value);
  if (typeof value === 'string' && /^-?\d+$/.test(value)) return BigInt(value);
  return fallback;
}
