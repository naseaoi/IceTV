import 'server-only';

import { cookies } from 'next/headers';

import {
  DEFAULT_DOUBAN_IMAGE_PROXY_TYPE,
  type DoubanImageProxyType,
} from '@/lib/douban-source';
import {
  DOUBAN_IMAGE_PROXY_TYPE_COOKIE,
  normalizePublicDoubanImageProxyType,
} from '@/lib/douban-image-url';

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
