/** Schemes that run code or read local data when navigated to: never a valid return_url. */
const BLOCKED_SCHEMES = new Set(['javascript:', 'data:', 'vbscript:', 'file:', 'blob:', 'about:']);

/**
 * Validates the checkout `return_url` (PRD §9.3): an http(s) URL or an app deep link
 * (`meuapp://compra-ok`). Returns the normalized URL, or null when it is unsafe or invalid.
 */
export function safeReturnUrl(value: string | null | undefined): string | null {
  if (!value || value.length > 2048) return null;
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  const scheme = url.protocol.toLowerCase();
  if (BLOCKED_SCHEMES.has(scheme)) return null;
  if ((scheme === 'http:' || scheme === 'https:') && !url.hostname) return null;
  // Deep links: a plain custom scheme (RFC 3986 letters, digits, + - .).
  if (!/^[a-z][a-z0-9+.-]*:$/.test(scheme)) return null;
  return url.toString();
}
