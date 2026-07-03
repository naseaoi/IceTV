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
