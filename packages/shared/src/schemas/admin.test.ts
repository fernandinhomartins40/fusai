import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, settingsSchema } from './admin';

describe('admin decimal fields', () => {
  it('rejects non-numeric text instead of throwing', () => {
    const result = settingsSchema.safeParse({ ...DEFAULT_SETTINGS, default_markup: 'abc' });
    expect(result.success).toBe(false);
  });
});
