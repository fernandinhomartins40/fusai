import { describe, expect, it } from 'vitest';
import { safeReturnUrl } from './return-url';

describe('safeReturnUrl', () => {
  it('accepts http(s) URLs and app deep links', () => {
    expect(safeReturnUrl('https://app.exemplo.com/ok?x=1')).toBe('https://app.exemplo.com/ok?x=1');
    expect(safeReturnUrl('http://localhost:3001/')).toBe('http://localhost:3001/');
    expect(safeReturnUrl('meuapp://compra-ok')).toBe('meuapp://compra-ok');
  });

  it('rejects script and local schemes, in any case', () => {
    for (const bad of [
      'javascript:alert(1)',
      'JavaScript:alert(1)',
      ' javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'vbscript:msgbox(1)',
      'file:///etc/passwd',
      'blob:https://x/1',
    ]) {
      expect(safeReturnUrl(bad), bad).toBeNull();
    }
  });

  it('rejects invalid or empty values', () => {
    expect(safeReturnUrl('')).toBeNull();
    expect(safeReturnUrl(null)).toBeNull();
    expect(safeReturnUrl('/relative/path')).toBeNull();
    expect(safeReturnUrl(`https://x.com/${'a'.repeat(3000)}`)).toBeNull();
  });
});
