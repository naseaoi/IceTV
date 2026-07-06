import {
  type DoubanImageProxyType,
  type DoubanProxyType,
  DEFAULT_DOUBAN_IMAGE_PROXY_TYPE,
  DEFAULT_DOUBAN_PROXY_TYPE,
} from '@/lib/douban-source';

export const doubanDataSourceOptions: { value: string; label: string }[] = [
  { value: 'direct', label: '直连（浏览器请求）' },
  { value: 'server', label: '代理（服务器请求）' },
  { value: 'cors-proxy-zwei', label: 'Cors Proxy By Zwei' },
  {
    value: 'cmliussss-cdn-tencent',
    label: '豆瓣 CDN By CMLiussss（腾讯云）',
  },
  { value: 'cmliussss-cdn-ali', label: '豆瓣 CDN By CMLiussss（阿里云）' },
  { value: 'custom', label: '自定义代理' },
];

export const siteDoubanDataSourceOptions = doubanDataSourceOptions.filter(
  (option) => option.value !== 'custom',
);

export const doubanImageProxyTypeOptions: { value: string; label: string }[] = [
  { value: 'direct', label: '直连（浏览器请求）' },
  { value: 'server', label: '代理（服务器请求）' },
  {
    value: 'cmliussss-cdn-tencent',
    label: '豆瓣 CDN By CMLiussss（腾讯云）',
  },
  { value: 'cmliussss-cdn-ali', label: '豆瓣 CDN By CMLiussss（阿里云）' },
  { value: 'custom', label: '自定义代理' },
];

export const siteDoubanImageProxyTypeOptions =
  doubanImageProxyTypeOptions.filter((option) => option.value !== 'custom');

export function normalizeSiteDoubanProxyType(value: unknown): DoubanProxyType {
  return siteDoubanDataSourceOptions.some((option) => option.value === value)
    ? (value as DoubanProxyType)
    : DEFAULT_DOUBAN_PROXY_TYPE;
}

export function normalizeSiteDoubanImageProxyType(
  value: unknown,
): DoubanImageProxyType {
  return siteDoubanImageProxyTypeOptions.some(
    (option) => option.value === value,
  )
    ? (value as DoubanImageProxyType)
    : DEFAULT_DOUBAN_IMAGE_PROXY_TYPE;
}

export function getThanksInfo(
  dataSource: string,
): { text: string; url: string } | null {
  switch (dataSource) {
    case 'cors-proxy-zwei':
      return {
        text: 'Thanks to @Zwei',
        url: 'https://github.com/bestzwei',
      };
    case 'cmliussss-cdn-tencent':
    case 'cmliussss-cdn-ali':
      return {
        text: 'Thanks to @CMLiussss',
        url: 'https://github.com/cmliu',
      };
    default:
      return null;
  }
}
