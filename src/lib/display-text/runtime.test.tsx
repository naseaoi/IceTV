import Image from 'next/image';
import Link from 'next/link';
import { Converter } from 'opencc-js/cn2t';
import { type ReactElement, createElement } from 'react';

import {
  createCachedDisplayConverter,
  DISPLAY_TEXT_CACHE_SIZE,
} from './conversion';
import { toDisplayHostProps } from './host-props';
import {
  type DisplayTextGlobals,
  createElement as displayCreateElement,
  toDisplayText,
} from './index';
import { jsxDEV } from './jsx-dev-runtime';
import { Fragment, jsx, jsxs } from './jsx-runtime';

const globals = globalThis as DisplayTextGlobals;

beforeEach(() => {
  document.documentElement.lang = 'zh-TW';
  globals.__ICETV_DISPLAY_CONVERTER__ = Converter({ from: 'cn', to: 'twp' });
});
afterEach(() => {
  document.documentElement.lang = '';
  delete globals.__ICETV_DISPLAY_CONVERTER__;
});

it('uses jsxImportSource in next/jest for JSX and nested arrays', () => {
  const element = <p title='软件'>视频{['设置', ['搜索']]}</p>;
  expect(element.props).toEqual({
    title: '軟體',
    children: ['影片', ['設定', ['搜尋']]],
  });
});

it('converts only display properties on host elements, without mutating input', () => {
  const child = createElement('span', null, '软件');
  const rawHtml = { __html: '软件' };
  const props = Object.freeze({
    children: ['软件', child, 1, false, null],
    placeholder: '设置',
    title: '视频',
    alt: '软件',
    'aria-label': '搜索',
    value: '软件',
    defaultValue: '软件',
    href: '/软件',
    id: '软件',
    'data-value': '软件',
    dangerouslySetInnerHTML: rawHtml,
  });
  const converted = toDisplayHostProps('div', props) as typeof props;
  expect(converted).toMatchObject({
    placeholder: '設定',
    title: '影片',
    alt: '軟體',
    'aria-label': '搜尋',
    value: '软件',
    defaultValue: '软件',
    href: '/软件',
    id: '软件',
    'data-value': '软件',
  });
  expect(converted.children).toEqual(['軟體', child, 1, false, null]);
  expect(converted.dangerouslySetInnerHTML).toBe(rawHtml);
  expect(props.children[0]).toBe('软件');
  expect(toDisplayHostProps(() => null, props)).toBe(props);
  expect(toDisplayHostProps(Fragment, props)).toEqual({
    ...props,
    children: ['軟體', child, 1, false, null],
  });
});

it('handles Fragment, Link and Image by identity and only converts their designated fields', () => {
  const fragment = <>软件{['视频']}</>;
  expect(fragment.props.children).toEqual(['軟體', ['影片']]);
  const props = {
    children: '软件',
    href: '/软件',
    src: '/软件.png',
    title: '设置',
    alt: '视频',
    'aria-label': '搜索',
    'aria-description': '设置',
  };
  expect(toDisplayHostProps(Link, props)).toEqual({
    ...props,
    children: '軟體',
    title: '設定',
    'aria-label': '搜尋',
  });
  expect(toDisplayHostProps(Image, props)).toEqual({ ...props, alt: '影片' });
  const custom = Object.assign(() => null, { displayName: 'Link' });
  expect(toDisplayHostProps(custom, props)).toBe(props);
  expect(
    toDisplayHostProps('input', {
      'aria-valuetext': '软件',
      'aria-placeholder': '搜索',
      'aria-description': '设置',
    }),
  ).toEqual({
    'aria-valuetext': '軟體',
    'aria-placeholder': '搜尋',
    'aria-description': '設定',
  });
});

it.each(['script', 'style', 'textarea'])('preserves %s children', (tag) => {
  const props = { children: ['软件'], title: '设置' };
  expect(toDisplayHostProps(tag, props)).toEqual({
    children: props.children,
    title: '設定',
  });
});

it('passes simplified, non-CJK and unavailable converter paths through unchanged', () => {
  const props = { children: '软件' };
  document.documentElement.lang = 'zh-CN';
  expect(toDisplayHostProps('span', props)).toBe(props);
  document.documentElement.lang = 'zh-TW';
  expect(toDisplayHostProps('span', { children: 'hello' })).toEqual({
    children: 'hello',
  });
  delete globals.__ICETV_DISPLAY_CONVERTER__;
  expect(toDisplayHostProps('span', props)).toBe(props);
  expect(toDisplayText('软件')).toBe('软件');
});

it('preserves React keys, refs and all runtime entry points', () => {
  const ref = { current: null };
  for (const render of [jsx, jsxs]) {
    const element = render(
      'span',
      { children: ['软件'], ref },
      'key',
    ) as ReactElement<{ children: string[]; ref: unknown }>;
    expect(element.key).toBe('key');
    expect(element.props).toEqual({ children: ['軟體'], ref });
  }
  const devElement = jsxDEV(
    'span',
    { children: '软件' },
    undefined,
    false,
    undefined,
    undefined,
  ) as ReactElement<{ children: string }>;
  expect(devElement.props.children).toBe('軟體');
});

it('keeps Taiwanese and Hong Kong converter results separate', () => {
  expect(toDisplayText('视频软件')).toBe('影片軟體');
  document.documentElement.lang = 'zh-HK';
  globals.__ICETV_DISPLAY_CONVERTER__ = Converter({ from: 'cn', to: 'hk' });
  expect(toDisplayText('视频软件')).toBe('視頻軟件');
});

it('bounds caching and skips non-CJK and oversized cache entries', () => {
  const raw = jest.fn((text: string) => text);
  const convert = createCachedDisplayConverter(raw);
  expect(convert('plain')).toBe('plain');
  expect(raw).not.toHaveBeenCalled();
  convert('软件');
  convert('软件');
  expect(raw).toHaveBeenCalledTimes(1);
  for (let i = 0; i < DISPLAY_TEXT_CACHE_SIZE; i++) convert(`视频${i}`);
  convert('软件');
  expect(raw).toHaveBeenCalledTimes(DISPLAY_TEXT_CACHE_SIZE + 2);
  const long = '软'.repeat(4097);
  convert(long);
  convert(long);
  expect(raw).toHaveBeenCalledTimes(DISPLAY_TEXT_CACHE_SIZE + 4);
});

it('caches synopsis-length text and evicts by total character budget', () => {
  const raw = jest.fn((text: string) => text);
  const convert = createCachedDisplayConverter(raw);
  const synopsis = (i: number) => `${i}`.padEnd(1000, '软');
  convert(synopsis(0));
  convert(synopsis(0));
  expect(raw).toHaveBeenCalledTimes(1);
  // 每条键加值 2000 字符，超过总预算后最早的条目被淘汰
  for (let i = 1; i <= 300; i++) convert(synopsis(i));
  convert(synopsis(300));
  expect(raw).toHaveBeenCalledTimes(301);
  convert(synopsis(0));
  expect(raw).toHaveBeenCalledTimes(302);
});

it('supports the actual SWC key-after-spread createElement fallback', () => {
  const props = Object.freeze({ title: '软件', children: '设置' });
  const element = (
    <span {...props} key='a'>
      软件
    </span>
  );
  expect(element.key).toBe('a');
  expect(element.props).toEqual({ title: '軟體', children: '軟體' });
  expect(props.children).toBe('设置');
});

it('preserves React createElement children precedence, ref, and component boundaries', () => {
  const ref = { current: null };
  const props = { title: '软件', children: '设置', ref, key: 'a' };
  expect(displayCreateElement('span', props).props.children).toBe('設定');
  expect(
    displayCreateElement('span', props, undefined).props.children,
  ).toBeUndefined();
  expect(displayCreateElement('span', props, null).props.children).toBeNull();
  const element = displayCreateElement('span', props, '软件', [
    '视频',
    ['搜索'],
  ]);
  expect(element.props.children).toEqual(['軟體', ['影片', ['搜尋']]]);
  expect(element.key).toBe('a');
  expect(element.props.ref).toBe(ref);
  expect(displayCreateElement(Fragment, null, '软件').props.children).toBe(
    '軟體',
  );
  expect(
    displayCreateElement(Link, { href: '/软件', title: '设置' }, '软件').props,
  ).toMatchObject({ href: '/软件', title: '設定', children: '軟體' });
  expect(
    displayCreateElement(Image, { src: '/软件.png', alt: '软件' }).props.alt,
  ).toBe('軟體');
  const Custom = (_props: { children?: string }) => null;
  expect(displayCreateElement(Custom, null, '软件').props.children).toBe(
    '软件',
  );
  expect(displayCreateElement('textarea', null, '软件').props.children).toBe(
    '软件',
  );
});

it('refreshes recency on hits so transient text evicts cold entries instead of hot labels', () => {
  const raw = jest.fn((text: string) => text);
  const convert = createCachedDisplayConverter(raw);
  convert('高频界面');
  convert('冷门文案');
  for (let i = 0; i < DISPLAY_TEXT_CACHE_SIZE - 2; i++) convert(`弹幕${i}`);
  convert('高频界面');
  convert('新弹幕');
  raw.mockClear();
  convert('高频界面');
  expect(raw).not.toHaveBeenCalled();
  convert('冷门文案');
  expect(raw).toHaveBeenCalledTimes(1);
});
