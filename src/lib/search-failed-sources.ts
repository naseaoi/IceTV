import type { ApiSite } from '@/lib/config';

export interface SearchFailedSource {
  key: string;
  name: string;
}

export function describeFailedSearchSources(
  apiSites: readonly ApiSite[],
  failedKeys: readonly string[] | undefined,
): SearchFailedSource[] {
  if (!failedKeys?.length) return [];
  const failed = new Set(failedKeys);
  return apiSites
    .filter((site) => failed.has(site.key))
    .map((site) => ({ key: site.key, name: site.name }));
}

export function parseSearchFailedSources(value: unknown): SearchFailedSource[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) =>
    item &&
    typeof item.key === 'string' &&
    item.key &&
    typeof item.name === 'string'
      ? [{ key: item.key, name: item.name }]
      : [],
  );
}
