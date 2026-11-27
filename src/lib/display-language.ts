import { clearDisplayPageCaches } from '@/lib/sw-cache-rules';

export type DisplayLanguage = 'zh-CN' | 'zh-TW' | 'zh-HK';
export type DisplayLanguagePreference = DisplayLanguage | 'auto';

export const DISPLAY_LANGUAGE_COOKIE = 'display_language';

export function parseDisplayLanguagePreference(
  value: unknown,
): DisplayLanguagePreference {
  return value === 'zh-CN' || value === 'zh-TW' || value === 'zh-HK'
    ? value
    : 'auto';
}

export function resolveDisplayLanguage(
  preference: unknown,
  acceptLanguage: string | null = null,
): DisplayLanguage {
  const selected = parseDisplayLanguagePreference(preference);
  if (selected !== 'auto') return selected;
  const languages = (acceptLanguage ?? '')
    .split(',')
    .map((entry) => {
      const [tag, ...params] = entry.trim().toLowerCase().split(';');
      const quality = params.find((param) => param.trim().startsWith('q='));
      return { tag, quality: quality ? Number(quality.trim().slice(2)) : 1 };
    })
    .filter(({ tag, quality }) => tag && quality > 0 && quality <= 1)
    .sort((a, b) => b.quality - a.quality);
  const tag = languages[0]?.tag ?? '';
  if (/^zh-(?:hant-)?(?:hk|mo)(?:-|$)/.test(tag)) return 'zh-HK';
  if (/^zh-(?:tw|hant)(?:-|$)/.test(tag)) return 'zh-TW';
  return 'zh-CN';
}

export function getRawDisplayLanguagePreference(): string | undefined {
  if (typeof document === 'undefined') return undefined;
  return document.cookie
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${DISPLAY_LANGUAGE_COOKIE}=`))
    ?.slice(DISPLAY_LANGUAGE_COOKIE.length + 1);
}

export function getDisplayLanguagePreference(): DisplayLanguagePreference {
  return parseDisplayLanguagePreference(getRawDisplayLanguagePreference());
}

// Snapshot once on document load, not on route changes or effect remounts.
const initialPreference = getRawDisplayLanguagePreference();

export function watchDisplayLanguagePreference(
  loadedPreference = initialPreference,
): () => void {
  let refreshing = false;
  const check = () => {
    if (
      document.visibilityState !== 'visible' ||
      refreshing ||
      getRawDisplayLanguagePreference() === loadedPreference
    )
      return;
    refreshing = true;
    void clearDisplayPageCaches().finally(() => {
      if (document.visibilityState === 'visible') location.reload();
      else refreshing = false;
    });
  };
  window.addEventListener('pageshow', check);
  document.addEventListener('visibilitychange', check);
  check();
  return () => {
    window.removeEventListener('pageshow', check);
    document.removeEventListener('visibilitychange', check);
  };
}

// 切换必须整页刷新，已有 RSC 与当前文档保持同一种语言。
export async function setDisplayLanguagePreference(
  preference: DisplayLanguagePreference,
): Promise<void> {
  if (typeof document === 'undefined') return;
  const value = parseDisplayLanguagePreference(preference);
  document.cookie = `${DISPLAY_LANGUAGE_COOKIE}=${value}; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol === 'https:' ? '; Secure' : ''}`;
  await clearDisplayPageCaches();
  location.reload();
}

export function getDocumentDisplayLanguage(): DisplayLanguage {
  return typeof document === 'undefined'
    ? 'zh-CN'
    : resolveDisplayLanguage(document.documentElement.lang);
}
