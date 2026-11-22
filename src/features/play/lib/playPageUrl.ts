import {
  forgetPlayReturnTo,
  readPlayReturnTo,
  rememberPlayReturnTo,
  RETURN_TO_PARAM,
} from '@/lib/navigation-return';
import type { SearchResult } from '@/lib/types';

export interface PlayPageTarget {
  source: string;
  id: string;
}

// 入口参数只在首次渲染读取；地址栏稳定后只保留源与 ID，其余一次性参数（如 tab）留给各自的消费方移除
const ENTRY_PARAMS = [
  'source',
  'id',
  'title',
  'year',
  'stitle',
  'stype',
  'prefer',
  'singleSource',
  'directStart',
  RETURN_TO_PARAM,
];

const SHORT_PATH_PATTERN = /^\/play\/([^/]+)\/([^/]+)$/;

// `.` / `..` 作为路径段会被 URL 规范化折叠（百分号编码同样），这类值保留查询式地址
function isDotSegment(value: string): boolean {
  return value === '.' || value === '..';
}

export function buildPlayPagePath({ source, id }: PlayPageTarget): string {
  if (isDotSegment(source) || isDotSegment(id)) {
    return `/play?${new URLSearchParams({ source, id })}`;
  }
  return `/play/${encodeURIComponent(source)}/${encodeURIComponent(id)}`;
}

export function parsePlayPagePath(pathname: string): PlayPageTarget | null {
  const match = SHORT_PATH_PATTERN.exec(pathname);
  if (!match) return null;
  try {
    return {
      source: decodeURIComponent(match[1]),
      id: decodeURIComponent(match[2]),
    };
  } catch {
    return null;
  }
}

export function isPlayPagePath(pathname: string): boolean {
  return pathname === '/play' || pathname.startsWith('/play/');
}

// 播放页标识：短地址按解析出的源与 ID 规范化，查询式地址取 source、id 参数
function getPlayPageKey(url: URL): string | null {
  const target =
    parsePlayPagePath(url.pathname) ??
    (url.pathname === '/play'
      ? {
          source: url.searchParams.get('source') ?? '',
          id: url.searchParams.get('id') ?? '',
        }
      : null);
  return target?.source && target.id ? buildPlayPagePath(target) : null;
}

// 带标题等入口参数的查询式地址是一次新的进入，来源只看地址参数
function isEntryUrl(url: URL): boolean {
  if (url.pathname !== '/play') return false;
  return ENTRY_PARAMS.some(
    (key) => key !== 'source' && key !== 'id' && url.searchParams.has(key),
  );
}

export function readCurrentPlayReturnTo(): string | null {
  const url = new URL(window.location.href);
  const returnTo = url.searchParams.get(RETURN_TO_PARAM);
  if (returnTo || isEntryUrl(url)) return returnTo;
  const key = getPlayPageKey(url);
  return key ? readPlayReturnTo(key) : null;
}

// 地址栏只记录当前播放的源；页面状态只在首次渲染读取地址参数，替换地址不会重新初始化。
// state 传 null 让路由同步新地址，否则之后任一路由更新都会把地址栏改回换源前的源
export function replacePlayPageUrl(
  detail: Pick<SearchResult, 'source' | 'id'>,
): boolean {
  if (
    typeof window === 'undefined' ||
    !isPlayPagePath(window.location.pathname)
  ) {
    return false;
  }

  const currentUrl = new URL(window.location.href);
  const returnTo = readCurrentPlayReturnTo();
  const nextPage = buildPlayPagePath(detail);
  const nextUrl = new URL(nextPage, currentUrl);
  currentUrl.searchParams.forEach((value, key) => {
    if (!ENTRY_PARAMS.includes(key)) nextUrl.searchParams.append(key, value);
  });
  nextUrl.hash = currentUrl.hash;
  if (returnTo) rememberPlayReturnTo(nextPage, returnTo);
  else forgetPlayReturnTo(nextPage);
  window.history.replaceState(null, '', nextUrl.toString());
  return true;
}
