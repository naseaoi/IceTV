import 'server-only';

import { cookies } from 'next/headers';

import {
  DOUBAN_IMAGE_PROXY_TYPE_COOKIE,
  normalizePublicDoubanImageProxyType,
} from '@/lib/douban-image-url';
import {
  type DoubanImageProxyType,
  DEFAULT_DOUBAN_IMAGE_PROXY_TYPE,
} from '@/lib/douban-source';

export async function readServerDoubanImageProxyType(
  defaultProxyType: string | undefined,
): Promise<DoubanImageProxyType> {
  const cookieStore = await cookies();
  const savedProxyType = cookieStore.get(DOUBAN_IMAGE_PROXY_TYPE_COOKIE)?.value;
  const normalizedDefault = normalizePublicDoubanImageProxyType(
    defaultProxyType,
    DEFAULT_DOUBAN_IMAGE_PROXY_TYPE,
  );

  return normalizePublicDoubanImageProxyType(savedProxyType, normalizedDefault);
}
