import { workUnitAsyncStorage } from 'next/dist/server/app-render/work-unit-async-storage.external';

import {
  type DisplayLanguage,
  DISPLAY_LANGUAGE_COOKIE,
  resolveDisplayLanguage,
} from '@/lib/display-language';

import { buildDisplayCommon, buildDisplayVariant } from './build';
import { createCompactCommon, createCompactConverter } from './compact';
import {
  type DisplayConverter,
  createCachedDisplayConverter,
} from './conversion';
import type { DisplayTextGlobals } from './index';

let common: ReturnType<typeof createCompactCommon> | undefined;
const converters = new Map<DisplayLanguage, DisplayConverter>();
// 每次 JSX 调用都会解析语言，按请求 store 缓存结果，避免逐元素解析 cookie 与 Accept-Language。
const requestLanguages = new WeakMap<object, DisplayLanguage>();

// Next 内部 API 只在此处使用；升级时须重新验证 instrumentation、RSC、SSR 共享同一个 ALS。
export function getRequestDisplayLanguage(): DisplayLanguage {
  const store = workUnitAsyncStorage.getStore();
  if (!store || store.type !== 'request') return 'zh-CN';
  const cached = requestLanguages.get(store);
  if (cached) return cached;
  if (!store.cookies?.get || !store.headers?.get) {
    throw new Error(
      'Next request store is incompatible with display language resolution',
    );
  }
  const language = resolveDisplayLanguage(
    store.cookies.get(DISPLAY_LANGUAGE_COOKIE)?.value,
    store.headers.get('accept-language'),
  );
  requestLanguages.set(store, language);
  return language;
}

export function registerDisplayText(): void {
  if (typeof workUnitAsyncStorage?.getStore !== 'function') {
    throw new Error(
      'Next workUnitAsyncStorage is unavailable for display language resolution',
    );
  }
  (globalThis as DisplayTextGlobals).__ICETV_GET_DISPLAY_LANGUAGE__ =
    getRequestDisplayLanguage;
  (globalThis as DisplayTextGlobals).__ICETV_GET_DISPLAY_CONVERTER__ = () => {
    const language = getRequestDisplayLanguage();
    if (language === 'zh-CN') return undefined;
    let converter = converters.get(language);
    if (!converter) {
      converter = createCachedDisplayConverter(
        createCompactConverter(
          (common ??= createCompactCommon(buildDisplayCommon())),
          buildDisplayVariant(language),
        ),
      );
      converters.set(language, converter);
    }
    return converter;
  };
}
