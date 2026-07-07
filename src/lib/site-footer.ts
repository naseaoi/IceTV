export const DEFAULT_SITE_FOOTER_TEXT =
  '本站仅提供影视信息搜索服务，不存储、不上传、不分发任何音视频资源。播放内容来自第三方站点，请自行判断来源与版权风险。';

export function normalizeSiteFooterText(value: unknown): string {
  return typeof value === 'string' && value.trim()
    ? value
    : DEFAULT_SITE_FOOTER_TEXT;
}
