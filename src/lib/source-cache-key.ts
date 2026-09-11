import type { ApiSite } from '@/lib/config';

export function getSourceCacheKey(site: ApiSite): string {
  return JSON.stringify([site.key, site.api, site.detail || '', site.name]);
}
