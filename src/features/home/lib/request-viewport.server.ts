import 'server-only';

import { headers } from 'next/headers';

const MOBILE_UA_RE = /Mobi|Android|iPhone|iPod/i;

// 仅用于决定首屏预加载哪套布局的图片；布局本身仍由 CSS 断点决定，判断错只少一次预加载
export async function isLikelyMobileRequest(): Promise<boolean> {
  const requestHeaders = await headers();
  const chMobile = requestHeaders.get('sec-ch-ua-mobile');
  if (chMobile) return chMobile === '?1';
  return MOBILE_UA_RE.test(requestHeaders.get('user-agent') ?? '');
}
