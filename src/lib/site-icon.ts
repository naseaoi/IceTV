// 主屏图标单独留白：iOS 会把整张图铺满圆角方块，透明区域渲染成黑色
export const DEFAULT_APPLE_TOUCH_ICON = '/icons/apple-touch-icon.png';

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
