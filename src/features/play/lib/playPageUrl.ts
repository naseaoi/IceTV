import type { SearchResult } from '@/lib/types';

// 地址栏只记录当前播放的源；页面状态只在首次渲染读取地址参数，替换地址不会重新初始化。
// state 传 null 让路由同步新地址，否则之后任一路由更新都会把地址栏改回换源前的源
export function replacePlayPageUrl(
  detail: Pick<SearchResult, 'source' | 'id' | 'title'>,
  year: string,
): boolean {
  if (typeof window === 'undefined' || window.location.pathname !== '/play') {
    return false;
  }

  const nextUrl = new URL(window.location.href);
  nextUrl.searchParams.set('source', detail.source);
  nextUrl.searchParams.set('id', detail.id);
  nextUrl.searchParams.set('year', year);
  nextUrl.searchParams.set('title', detail.title);
  nextUrl.searchParams.delete('prefer');
  nextUrl.searchParams.delete('singleSource');
  nextUrl.searchParams.delete('directStart');
  window.history.replaceState(null, '', nextUrl.toString());
  return true;
}
