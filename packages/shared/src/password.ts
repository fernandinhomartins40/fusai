/**
 * Strong password rules, shared by the web forms (live feedback) and the API (enforced on
 * sign-up and password reset, so the rule cannot be bypassed by calling the API directly).
 */
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

export type PasswordRequirement = { id: string; label: string; met: boolean };
export type PasswordStrength = {
  /** 0 (empty) .. 4 (strong and long). */
  score: 0 | 1 | 2 | 3 | 4;
  level: 'vazia' | 'fraca' | 'media' | 'forte';
  label: string;
  requirements: PasswordRequirement[];
  /** Every requirement met: the only state accepted on sign-up and reset. */
  valid: boolean;
};

export function passwordRequirements(password: string): PasswordRequirement[] {
  return [
    {
      id: 'length',
      label: `Pelo menos ${PASSWORD_MIN_LENGTH} caracteres`,
      met: password.length >= PASSWORD_MIN_LENGTH,
    },
    { id: 'lower', label: 'Uma letra minúscula', met: /\p{Ll}/u.test(password) },
    { id: 'upper', label: 'Uma letra maiúscula', met: /\p{Lu}/u.test(password) },
    { id: 'number', label: 'Um número', met: /\d/.test(password) },
    {
      id: 'symbol',
      label: 'Um símbolo (ex.: ! @ # $ %)',
      met: /[^\p{L}\d\s]/u.test(password),
    },
  ];
}

export function passwordStrength(password: string): PasswordStrength {
  const requirements = passwordRequirements(password);
  const met = requirements.filter((r) => r.met).length;
  const valid = met === requirements.length && password.length <= PASSWORD_MAX_LENGTH;
  if (!password) return { score: 0, level: 'vazia', label: '', requirements, valid: false };
  if (valid) {
    const score = password.length >= 12 ? 4 : 3;
    return { score, level: 'forte', label: 'Forte', requirements, valid };
  }
  if (met >= 4) return { score: 2, level: 'media', label: 'Média', requirements, valid };
  return { score: 1, level: 'fraca', label: 'Fraca', requirements, valid };
}

/** First unmet requirement as a sentence (server error message). */
export function passwordProblem(password: string): string | null {
  if (password.length > PASSWORD_MAX_LENGTH) {
    return `A senha pode ter no máximo ${PASSWORD_MAX_LENGTH} caracteres.`;
  }
  const missing = passwordRequirements(password).filter((r) => !r.met);
  if (missing.length === 0) return null;
  return `Senha fraca. Falta: ${missing.map((r) => r.label.toLowerCase()).join(', ')}.`;
}
