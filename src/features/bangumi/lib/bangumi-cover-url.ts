const BANGUMI_COVER_HOST = 'lain.bgm.tv';
const BANGUMI_COVER_PROXY_PREFIX = '/api/bangumi-cover';
const BANGUMI_COVER_SIZE_RE = /^[lcmgs]$/i;
const BANGUMI_COVER_FOLDER_RE = /^[0-9a-f]{2}$/i;
const BANGUMI_COVER_FILE_RE = /^[a-z0-9][a-z0-9_-]*\.(?:jpg|jpeg|png|webp)$/i;

export function toBangumiCoverProxyUrl(rawUrl: string): string {
  const routePath = getBangumiCoverRoutePath(rawUrl);

  return routePath ? `${BANGUMI_COVER_PROXY_PREFIX}${routePath}` : '';
}

export function isBangumiCoverProxyUrl(url: string): boolean {
  return url.startsWith(`${BANGUMI_COVER_PROXY_PREFIX}/`);
}

// 卡片数据保留可直连的原图地址（统一为 https），渲染时再映射到本站代理，代理失败可回退原图
export function toBangumiCoverDirectUrl(rawUrl: string): string {
  const routePath = getBangumiCoverRoutePath(rawUrl);

  return routePath ? `https://${BANGUMI_COVER_HOST}/pic/cover${routePath}` : '';
}

export function getBangumiCoverTargetUrl(
  pathSegments: readonly string[],
): URL | null {
  if (pathSegments.length !== 4) {
    return null;
  }

  const [size, firstFolder, secondFolder, filename] =
    pathSegments.map(decodeRouteSegment);

  if (
    !BANGUMI_COVER_SIZE_RE.test(size) ||
    !BANGUMI_COVER_FOLDER_RE.test(firstFolder) ||
    !BANGUMI_COVER_FOLDER_RE.test(secondFolder) ||
    !BANGUMI_COVER_FILE_RE.test(filename)
  ) {
    return null;
  }

  return new URL(
    `/pic/cover/${size.toLowerCase()}/${firstFolder.toLowerCase()}/${secondFolder.toLowerCase()}/${filename}`,
    `https://${BANGUMI_COVER_HOST}`,
  );
}

function getBangumiCoverRoutePath(rawUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return '';
  }

  if (
    (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
    parsed.hostname.toLowerCase() !== BANGUMI_COVER_HOST
  ) {
    return '';
  }

  const pathSegments = parsed.pathname.split('/').filter(Boolean);
  if (
    pathSegments.length !== 6 ||
    pathSegments[0] !== 'pic' ||
    pathSegments[1] !== 'cover'
  ) {
    return '';
  }

  const targetUrl = getBangumiCoverTargetUrl(pathSegments.slice(2));

  return targetUrl ? targetUrl.pathname.replace('/pic/cover', '') : '';
}

function decodeRouteSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return '';
  }
}
