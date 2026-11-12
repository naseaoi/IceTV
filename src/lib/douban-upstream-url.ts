// 豆瓣上游地址的唯一构建处：客户端直连 / 镜像与服务端路由共用，参数统一经 URLSearchParams 编码
const DOUBAN_HOSTS = {
  douban: { m: 'https://m.douban.com', movie: 'https://movie.douban.com' },
  'cmliussss-tencent': {
    m: 'https://m.douban.cmliussss.net',
    movie: 'https://movie.douban.cmliussss.net',
  },
  'cmliussss-ali': {
    m: 'https://m.douban.cmliussss.com',
    movie: 'https://movie.douban.cmliussss.com',
  },
} as const;

export type DoubanUpstreamHost = keyof typeof DOUBAN_HOSTS;

export interface DoubanRecentHotQuery {
  kind: 'tv' | 'movie';
  category: string;
  type: string;
  start: number;
  limit: number;
}

export function buildDoubanRecentHotUrl(
  { kind, category, type, start, limit }: DoubanRecentHotQuery,
  host: DoubanUpstreamHost = 'douban',
): string {
  const params = new URLSearchParams({
    start: String(start),
    limit: String(limit),
    category,
    type,
  });
  return `${DOUBAN_HOSTS[host].m}/rexxar/api/v2/subject/recent_hot/${kind}?${params}`;
}

export interface DoubanSearchSubjectsQuery {
  type: 'tv' | 'movie';
  tag: string;
  start: number;
  limit: number;
}

export function buildDoubanSearchSubjectsUrl(
  { type, tag, start, limit }: DoubanSearchSubjectsQuery,
  host: DoubanUpstreamHost = 'douban',
): string {
  const params = new URLSearchParams({
    type,
    tag,
    sort: 'recommend',
    page_limit: String(limit),
    page_start: String(start),
  });
  return `${DOUBAN_HOSTS[host].movie}/j/search_subjects?${params}`;
}

export interface DoubanRecommendQuery {
  kind: 'tv' | 'movie';
  start: number;
  limit: number;
  category?: string | null;
  format?: string | null;
  label?: string | null;
  region?: string | null;
  year?: string | null;
  platform?: string | null;
  sort?: string | null;
}

// 筛选项的「全部」/ 默认排序在界面上有显式取值，上游要求留空
function filterValue(value: string | null | undefined, anyValue = 'all') {
  return !value || value === anyValue ? '' : value;
}

export function buildDoubanRecommendUrl(
  query: DoubanRecommendQuery,
  host: DoubanUpstreamHost = 'douban',
): string {
  const category = filterValue(query.category);
  const format = filterValue(query.format);
  const label = filterValue(query.label);
  const region = filterValue(query.region);
  const year = filterValue(query.year);
  const platform = filterValue(query.platform);
  const sort = filterValue(query.sort, 'T');

  const selectedCategories: Record<string, string> = { 类型: category };
  if (format) selectedCategories['形式'] = format;
  if (region) selectedCategories['地区'] = region;

  const tags = [category || format, label, region, year, platform].filter(
    Boolean,
  );

  const params = new URLSearchParams({
    refresh: '0',
    start: String(query.start),
    count: String(query.limit),
    selected_categories: JSON.stringify(selectedCategories),
    uncollect: 'false',
    score_range: '0,10',
    tags: tags.join(','),
  });
  if (sort) params.set('sort', sort);
  return `${DOUBAN_HOSTS[host].m}/rexxar/api/v2/${query.kind}/recommend?${params}`;
}
