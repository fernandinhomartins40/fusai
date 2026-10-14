import { describe, expect, it } from 'vitest';
import { formatDocument, isValidCnpj, isValidCpf, isValidDocument } from './document';
import { slugify } from './slug';

describe('documents', () => {
  it('validates CPF check digits', () => {
    expect(isValidCpf('529.982.247-25')).toBe(true);
    expect(isValidCpf('52998224725')).toBe(true);
    expect(isValidCpf('529.982.247-24')).toBe(false);
    expect(isValidCpf('111.111.111-11')).toBe(false);
    expect(isValidCpf('123')).toBe(false);
  });

  it('validates CNPJ check digits', () => {
    expect(isValidCnpj('11.222.333/0001-81')).toBe(true);
    expect(isValidCnpj('11222333000181')).toBe(true);
    expect(isValidCnpj('11.222.333/0001-80')).toBe(false);
    expect(isValidCnpj('00.000.000/0000-00')).toBe(false);
  });

  it('picks the right validator by length', () => {
    expect(isValidDocument('52998224725')).toBe(true);
    expect(isValidDocument('11222333000181')).toBe(true);
    expect(isValidDocument('1234567')).toBe(false);
  });

  it('formats documents', () => {
    expect(formatDocument('52998224725')).toBe('529.982.247-25');
    expect(formatDocument('11222333000181')).toBe('11.222.333/0001-81');
  });
});

describe('slugify', () => {
  it('strips accents and symbols', () => {
    expect(slugify('Açaí & Cia Ltda.')).toBe('acai-cia-ltda');
    expect(slugify('  --Meu App--  ')).toBe('meu-app');
  });
});
