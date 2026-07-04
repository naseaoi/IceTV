export type LazyEpisodeKind = 'giri' | 'xgcartoon';

export interface LazyEpisodeTarget {
  kind: LazyEpisodeKind;
  path: string;
}

const LAZY_EPISODE_SCHEME = 'icetv-lazy://';

const LAZY_PATH_PATTERNS: Record<LazyEpisodeKind, RegExp> = {
  giri: /^\/playGV\d+-\d+-\d+\/$/,
  xgcartoon: /^\/video\/[\w-]+\/[\w-]+\.html$/,
};

export function buildLazyEpisodeUrl(
  kind: LazyEpisodeKind,
  path: string,
): string {
  return `${LAZY_EPISODE_SCHEME}${kind}${path}`;
}

export function isLazyEpisodeUrl(url: string): boolean {
  return typeof url === 'string' && url.startsWith(LAZY_EPISODE_SCHEME);
}

export function parseLazyEpisodeUrl(url: string): LazyEpisodeTarget | null {
  if (!isLazyEpisodeUrl(url)) {
    return null;
  }

  const rest = url.slice(LAZY_EPISODE_SCHEME.length);
  const slashIndex = rest.indexOf('/');
  if (slashIndex <= 0) {
    return null;
  }

  const kind = rest.slice(0, slashIndex) as LazyEpisodeKind;
  const path = rest.slice(slashIndex);
  const pattern = LAZY_PATH_PATTERNS[kind];
  if (!pattern || !pattern.test(path)) {
    return null;
  }

  return { kind, path };
}
