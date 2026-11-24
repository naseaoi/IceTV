// 默认图标文件名固定，按应用版本加查询参数，换图后浏览器与 CDN 的长缓存随发版失效
function withAppVersion(path: string): string {
  const version = process.env.NEXT_PUBLIC_APP_VERSION?.trim();
  return version ? `${path}?v=${encodeURIComponent(version)}` : path;
}

export const DEFAULT_FAVICON = withAppVersion('/favicon.ico');
export const DEFAULT_SITE_ICON = withAppVersion('/icons/icon-192x192.png');
// 主屏图标单独留白：iOS 会把整张图铺满圆角方块，透明区域渲染成黑色
export const DEFAULT_APPLE_TOUCH_ICON = withAppVersion(
  '/icons/apple-touch-icon.png',
);

export function withSiteIconCacheBuster(
  siteIcon: string | undefined,
  token: string | number,
): string {
  if (!siteIcon) {
    return '';
  }

  if (!siteIcon.startsWith('/api/admin/site-icon')) {
    return siteIcon;
  }

  const separator = siteIcon.includes('?') ? '&' : '?';
  return `${siteIcon}${separator}t=${encodeURIComponent(String(token))}`;
}
