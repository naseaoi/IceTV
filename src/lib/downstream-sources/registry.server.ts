import 'server-only';

import type { ApiSite } from '@/lib/config';
import type { LazyEpisodeKind } from '@/lib/lazy-episodes';
import type { SearchResult } from '@/lib/types';

import {
  getDetailFromGirigiri,
  isGirigiriSource,
  resolveGirigiriEpisodePlayUrlByPath,
  searchFromGirigiri,
} from './giri';
import {
  getDetailFromOlevod,
  isOlevodSource,
  searchFromOlevod,
} from './olevod';
import { getDetailFromPpnix, isPpnixSource, searchFromPpnix } from './ppnix';
import { isTyyszySource, searchFromTyyszy } from './tyyszy';
import {
  getDetailFromXgcartoon,
  isXgcartoonSource,
  resolveXgcartoonEpisodeUrlByPath,
  searchFromXgcartoon,
} from './xgcartoon';
import {
  getDetailFromXifan,
  isXifanSource,
  resolveXifanEpisodeUrlByPath,
  searchFromXifan,
} from './xifan';

export interface SpecialSourceAdapter {
  matches: (site: ApiSite) => boolean;
  search: (
    site: ApiSite,
    query: string,
    signal?: AbortSignal,
  ) => Promise<SearchResult[]>;
  detail?: (site: ApiSite, id: string) => Promise<SearchResult>;
  episode?: {
    kind: LazyEpisodeKind;
    resolve: (site: ApiSite, path: string) => Promise<string | null>;
  };
  // 允许 quick 跳过详情等待；候选仍须通过字段完整性与媒体地址检查。
  canStartFromSearch: boolean;
}

// 每个客户端 kind 都必须注册同名适配器及解析器，纯搜索适配器无需逐集解析。
type SpecialSourceRegistry = Record<string, SpecialSourceAdapter> & {
  [Kind in LazyEpisodeKind]: SpecialSourceAdapter & {
    episode: NonNullable<SpecialSourceAdapter['episode']> & { kind: Kind };
  };
};

export const specialSourceAdapters = {
  giri: {
    matches: isGirigiriSource,
    search: searchFromGirigiri,
    detail: getDetailFromGirigiri,
    episode: { kind: 'giri', resolve: resolveGirigiriEpisodePlayUrlByPath },
    canStartFromSearch: false,
  },
  xgcartoon: {
    matches: isXgcartoonSource,
    search: searchFromXgcartoon,
    detail: getDetailFromXgcartoon,
    episode: { kind: 'xgcartoon', resolve: resolveXgcartoonEpisodeUrlByPath },
    canStartFromSearch: false,
  },
  xifan: {
    matches: isXifanSource,
    search: searchFromXifan,
    detail: getDetailFromXifan,
    episode: { kind: 'xifan', resolve: resolveXifanEpisodeUrlByPath },
    canStartFromSearch: false,
  },
  tyyszy: {
    matches: isTyyszySource,
    search: searchFromTyyszy,
    canStartFromSearch: true,
  },
  olevod: {
    matches: isOlevodSource,
    search: searchFromOlevod,
    detail: getDetailFromOlevod,
    canStartFromSearch: false,
  },
  ppnix: {
    matches: isPpnixSource,
    search: searchFromPpnix,
    detail: getDetailFromPpnix,
    canStartFromSearch: false,
  },
} satisfies SpecialSourceRegistry;

export function getSpecialSourceAdapter(
  site: ApiSite,
): SpecialSourceAdapter | undefined {
  return Object.values(specialSourceAdapters).find((adapter) =>
    adapter.matches(site),
  );
}
