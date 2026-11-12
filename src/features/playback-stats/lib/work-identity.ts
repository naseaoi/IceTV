import { normalizeWorkTitle, normalizeWorkYear } from '@/lib/source-match';

export function playbackWorkIdentity(work: {
  title: string;
  year: string;
}): string {
  return JSON.stringify([
    normalizeWorkTitle(work.title),
    normalizeWorkYear(work.year),
  ]);
}
