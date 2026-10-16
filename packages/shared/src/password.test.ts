import { describe, expect, it } from 'vitest';
import { passwordProblem, passwordStrength } from './password';
import { resetPasswordSchema, signUpSchema } from './schemas/auth';

describe('password strength', () => {
  it('grades empty, weak, medium and strong passwords', () => {
    expect(passwordStrength('').level).toBe('vazia');
    expect(passwordStrength('abc').level).toBe('fraca');
    expect(passwordStrength('abcdefgh').level).toBe('fraca');
    expect(passwordStrength('Abcdefg1').level).toBe('media'); // missing a symbol
    expect(passwordStrength('Abcdef1!')).toMatchObject({ level: 'forte', score: 3, valid: true });
    expect(passwordStrength('Abcdefghij1!')).toMatchObject({ level: 'forte', score: 4 });
  });

  it('lists each requirement as met or not', () => {
    const reqs = passwordStrength('abc1').requirements;
    expect(reqs.find((r) => r.id === 'number')?.met).toBe(true);
    expect(reqs.find((r) => r.id === 'upper')?.met).toBe(false);
    expect(reqs).toHaveLength(5);
  });

  it('accepts accented letters and explains what is missing', () => {
    expect(passwordStrength('Ação123!').valid).toBe(true);
    expect(passwordProblem('senhafraca')).toMatch(/maiúscula.*número.*símbolo/);
    expect(passwordProblem('Senha-Forte1')).toBeNull();
  });

  it('sign-up and reset require a strong password and a matching confirmation', () => {
    const base = { name: 'Ana', email: 'ana@exemplo.com' };
    expect(
      signUpSchema.safeParse({ ...base, password: 'Senha-Forte1', confirm: 'Senha-Forte1' })
        .success,
    ).toBe(true);
    expect(
      signUpSchema.safeParse({ ...base, password: 'senhafraca', confirm: 'senhafraca' }).success,
    ).toBe(false);
    const mismatch = signUpSchema.safeParse({
      ...base,
      password: 'Senha-Forte1',
      confirm: 'Senha-Forte2',
    });
    expect(mismatch.error?.issues[0]?.path).toEqual(['confirm']);
    expect(resetPasswordSchema.safeParse({ password: 'curta', confirm: 'curta' }).success).toBe(
      false,
    );
  });
});
