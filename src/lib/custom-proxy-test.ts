export type CustomProxyTestKind = 'douban-data' | 'douban-image' | 'bangumi';

export const CUSTOM_PROXY_LABELS: Record<CustomProxyTestKind, string> = {
  'douban-data': '豆瓣代理',
  'douban-image': '豆瓣图片代理',
  bangumi: 'Bangumi 代理',
};

const TEST_TARGET_URLS: Record<CustomProxyTestKind, string> = {
  'douban-data':
    'https://movie.douban.com/j/search_subjects?type=movie&tag=%E7%83%AD%E9%97%A8&sort=recommend&page_limit=1&page_start=0',
  'douban-image':
    'https://img1.doubanio.com/view/photo/s_ratio_poster/public/p480747492.jpg',
  bangumi: 'https://api.bgm.tv/calendar',
};

const TEST_TIMEOUT_MS = 10000;

export function normalizeCustomProxyUrl(value: string): string {
  return value.trim();
}

export function getCustomProxyRequiredMessage(label: string): string {
  return `请填写${label}地址`;
}

export function getCustomProxyError(
  kind: CustomProxyTestKind,
  proxyUrl: string,
): string {
  return normalizeCustomProxyUrl(proxyUrl)
    ? ''
    : getCustomProxyRequiredMessage(CUSTOM_PROXY_LABELS[kind]);
}

export function buildCustomProxyRequestUrl(
  proxyUrl: string,
  targetUrl: string,
): string {
  return `${normalizeCustomProxyUrl(proxyUrl)}${encodeURIComponent(targetUrl)}`;
}

export async function testCustomProxy(
  kind: CustomProxyTestKind,
  proxyUrl: string,
): Promise<void> {
  const normalizedProxyUrl = normalizeCustomProxyUrl(proxyUrl);
  if (!normalizedProxyUrl) {
    throw new Error('代理地址不能为空');
  }

  const targetUrl = TEST_TARGET_URLS[kind];
  const requestUrl = buildCustomProxyRequestUrl(normalizedProxyUrl, targetUrl);
  new URL(requestUrl, window.location.origin);

  if (kind === 'douban-image') {
    await testImageProxy(requestUrl);
    return;
  }

  await testJsonProxy(requestUrl);
}

async function testJsonProxy(requestUrl: string): Promise<void> {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(
    () => controller.abort(),
    TEST_TIMEOUT_MS,
  );

  try {
    const response = await fetch(requestUrl, {
      cache: 'no-store',
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`代理返回 ${response.status}`);
    }

    await response.json();
  } finally {
    window.clearTimeout(timeoutId);
  }
}

function testImageProxy(requestUrl: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const timeoutId = window.setTimeout(() => {
      image.src = '';
      reject(new Error('图片加载超时'));
    }, TEST_TIMEOUT_MS);

    image.referrerPolicy = 'no-referrer';
    image.onload = () => {
      window.clearTimeout(timeoutId);
      resolve();
    };
    image.onerror = () => {
      window.clearTimeout(timeoutId);
      reject(new Error('图片加载失败'));
    };
    image.src = requestUrl;
  });
}
