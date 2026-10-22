import { prisma } from '@fusai/db';
import { DEFAULT_SETTINGS } from '@fusai/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetDb } from '../../test/helpers';
import { createSettingsStore } from './settings';

describe('settings store', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('PIE D-07: one invalid row falls back alone; the other settings keep their values', async () => {
    const rate = DEFAULT_SETTINGS.usd_brl_rate === '7.123456' ? '6.5' : '7.123456';
    await prisma.setting.createMany({
      data: [
        { key: 'usd_brl_rate', value: rate },
        { key: 'default_markup', value: 'não é número' },
      ],
    });
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const settings = await createSettingsStore(prisma).get();
    expect(settings.usd_brl_rate).toBe(rate);
    expect(settings.default_markup).toBe(DEFAULT_SETTINGS.default_markup);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('default_markup'));
    error.mockRestore();
  });

  it('save() only writes changed keys, so the exchange rate age stays real', async () => {
    const store = createSettingsStore(prisma);
    await store.save({ ...DEFAULT_SETTINGS });
    const before = await prisma.setting.findUniqueOrThrow({ where: { key: 'usd_brl_rate' } });
    await new Promise((resolve) => setTimeout(resolve, 20));
    const markup = DEFAULT_SETTINGS.default_markup === '3' ? '4' : '3';
    const saved = await store.save({ ...DEFAULT_SETTINGS, default_markup: markup });
    expect(saved.default_markup).toBe(markup);
    const after = await prisma.setting.findUniqueOrThrow({ where: { key: 'usd_brl_rate' } });
    expect(after.updatedAt.getTime()).toBe(before.updatedAt.getTime());
    const markupRow = await prisma.setting.findUniqueOrThrow({ where: { key: 'default_markup' } });
    expect(markupRow.updatedAt.getTime()).toBeGreaterThan(before.updatedAt.getTime());
  });
});
