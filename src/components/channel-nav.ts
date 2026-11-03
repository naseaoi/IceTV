import { getCustomCategoryLabel, RuntimeConfig } from '@/lib/runtime-config';

export const LIVE_ROUTE = '/live';

export type ChannelItem = { label: string; href: string };

// 首页与各内容频道；桌面顶栏在此基础上追加「我的」
export function getChannelItems(runtimeConfig?: RuntimeConfig): ChannelItem[] {
  const items: ChannelItem[] = [
    { label: '首页', href: '/' },
    { label: '电影', href: '/douban?type=movie' },
    { label: '剧集', href: '/douban?type=tv' },
    { label: '动漫', href: '/douban?type=anime' },
    { label: '综艺', href: '/douban?type=show' },
  ];

  if ((runtimeConfig?.CUSTOM_CATEGORIES?.length ?? 0) > 0) {
    items.push({
      label: getCustomCategoryLabel(runtimeConfig),
      href: '/douban?type=custom',
    });
  }
  if (runtimeConfig?.ENABLE_LIVE_ENTRY) {
    items.push({ label: '直播', href: LIVE_ROUTE });
  }

  return items;
}

// 带频道条的页面：首页与豆瓣分类页
export function isChannelPath(path: string): boolean {
  return path === '/' || path.startsWith('/douban');
}

// 分类页的筛选参数不在 pathname 中，靠页面传入的 activePath 区分类型
export function isNavItemActive(
  href: string,
  pathname: string,
  activePath: string,
): boolean {
  if (href === '/')
    return pathname === '/' || pathname === '/continue-watching';
  if (href.startsWith('/douban')) {
    const type = href.split('type=')[1];
    return pathname === '/douban' && activePath.includes(`type=${type}`);
  }
  if (href === '/me') {
    return pathname.startsWith('/me') || pathname.startsWith('/u/');
  }
  return pathname.startsWith(href);
}
