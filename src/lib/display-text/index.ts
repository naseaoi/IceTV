import { cloneElement, createElement as reactCreateElement } from 'react';

import {
  type DisplayLanguage,
  getDocumentDisplayLanguage,
} from '@/lib/display-language';

import {
  type DisplayConverter,
  createCachedDisplayConverter,
} from './conversion';
import { toDisplayHostProps } from './host-props';

export type DisplayTextGlobals = typeof globalThis & {
  __ICETV_GET_DISPLAY_LANGUAGE__?: () => DisplayLanguage;
  __ICETV_GET_DISPLAY_CONVERTER__?: () => DisplayConverter | undefined;
  __ICETV_DISPLAY_CONVERTER__?: DisplayConverter;
};

let clientConverter: DisplayConverter | undefined;
let cachedClientConverter: DisplayConverter | undefined;

export function getDisplayTextConverter(): DisplayConverter | undefined {
  const globals = globalThis as DisplayTextGlobals;
  if (typeof window === 'undefined')
    return globals.__ICETV_GET_DISPLAY_CONVERTER__?.();
  // 每次 JSX 调用都会经过这里，简体直通只做一次属性读取与比较。
  const lang = document.documentElement.lang;
  if (lang !== 'zh-TW' && lang !== 'zh-HK') return undefined;
  const converter = globals.__ICETV_DISPLAY_CONVERTER__;
  if (converter !== clientConverter) {
    clientConverter = converter;
    cachedClientConverter = converter
      ? createCachedDisplayConverter(converter)
      : undefined;
  }
  return cachedClientConverter;
}

export function getDisplayLanguage(): DisplayLanguage {
  return typeof window === 'undefined'
    ? ((globalThis as DisplayTextGlobals).__ICETV_GET_DISPLAY_LANGUAGE__?.() ??
        'zh-CN')
    : getDocumentDisplayLanguage();
}

// SWC uses this root entry for JSX with a key after a props spread.
// Let React resolve variadic children/defaultProps first, preserving key/ref and argument semantics.
export const createElement = ((
  ...args: Parameters<typeof reactCreateElement>
) => {
  const element = reactCreateElement(...args);
  const props = toDisplayHostProps(element.type, element.props);
  return props === element.props
    ? element
    : cloneElement(element, props as typeof element.props);
}) as typeof reactCreateElement;

export function toDisplayText(text: string): string {
  return getDisplayTextConverter()?.(text) ?? text;
}
