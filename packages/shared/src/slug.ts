/** URL-safe slug: lowercase ASCII, digits and single dashes ("Açaí & Cia" -> "acai-cia"). */
export function slugify(value: string, maxLength = 48): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLength)
    .replace(/-+$/, '');
}
