export function normalizeSearchQueryInput(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/[\u200b-\u200d\ufeff]/g, '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .trim()
    .replace(/\s+/g, ' ');
}
