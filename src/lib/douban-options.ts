/**
 * 豆瓣代理选项定义 — UserMenu（本地设置）和 SiteConfigTab（管理后台）共用。
 */

/** 豆瓣数据代理选项 */
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

/** 豆瓣图片代理选项 */
export const doubanImageProxyTypeOptions: { value: string; label: string }[] = [
  { value: 'direct', label: '直连（浏览器请求）' },
  { value: 'server', label: '代理（服务器请求）' },
  { value: 'img3', label: '豆瓣官方精品 CDN（阿里云）' },
  {
    value: 'cmliussss-cdn-tencent',
    label: '豆瓣 CDN By CMLiussss（腾讯云）',
  },
  { value: 'cmliussss-cdn-ali', label: '豆瓣 CDN By CMLiussss（阿里云）' },
  { value: 'custom', label: '自定义代理' },
];

/** 根据代理类型返回感谢信息，无需感谢时返回 null */
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
