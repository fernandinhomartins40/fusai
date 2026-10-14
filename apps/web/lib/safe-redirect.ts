/** Only allows same-site relative paths (blocks "//evil.com", "/\evil.com" and absolute URLs). */
export function safeNext(value: string | null | undefined, fallback = '/app'): string {
  if (!value?.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) {
    return fallback;
  }
  return value;
}
