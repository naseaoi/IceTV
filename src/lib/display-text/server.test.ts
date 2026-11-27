/** @jest-environment node */
import { workUnitAsyncStorage } from 'next/dist/server/app-render/work-unit-async-storage.external';
import { version } from 'next/package.json';

import { register } from '@/instrumentation';

import { buildDisplayCommon, buildDisplayVariant } from './build';
import {
  type DisplayTextGlobals,
  getDisplayLanguage,
  toDisplayText,
} from './index';
import { getRequestDisplayLanguage, registerDisplayText } from './server';

jest.mock(
  'next/dist/server/app-render/work-unit-async-storage.external',
  () => ({
    workUnitAsyncStorage: new (require('node:async_hooks').AsyncLocalStorage)(),
  }),
);
jest.mock('./build', () => {
  const actual = jest.requireActual('./build');
  return {
    buildDisplayCommon: jest.fn(actual.buildDisplayCommon),
    buildDisplayVariant: jest.fn(actual.buildDisplayVariant),
  };
});
jest.mock('@/lib/dev-proxy', () => ({ setupDevProxy: jest.fn() }));
jest.mock('@/lib/cron/dev-scheduler', () => ({ setupDevCron: jest.fn() }));

const store = (preference: string | undefined, language = 'zh-CN') =>
  ({
    type: 'request',
    cookies: {
      get: (key: string) =>
        key === 'display_language' && preference
          ? { value: preference }
          : undefined,
    },
    headers: { get: () => language },
  }) as unknown as Parameters<typeof workUnitAsyncStorage.run>[0];

afterEach(() => {
  delete (globalThis as DisplayTextGlobals).__ICETV_GET_DISPLAY_CONVERTER__;
  delete (globalThis as DisplayTextGlobals).__ICETV_GET_DISPLAY_LANGUAGE__;
});

it('requires the webpack and turbopack ALS probes to be rerun on a Next upgrade', () => {
  expect(version).toBe('16.2.10');
});

it('registers the actual hook from instrumentation and keeps concurrent requests isolated', async () => {
  const previous = process.env.NEXT_RUNTIME;
  process.env.NEXT_RUNTIME = 'nodejs';
  try {
    await register();
  } finally {
    if (previous === undefined) delete process.env.NEXT_RUNTIME;
    else process.env.NEXT_RUNTIME = previous;
  }
  workUnitAsyncStorage.run(store('zh-CN'), () => {
    expect(toDisplayText('视频软件')).toBe('视频软件');
  });
  expect(buildDisplayCommon).not.toHaveBeenCalled();
  expect(buildDisplayVariant).not.toHaveBeenCalled();
  const [tw, hk, cn] = await Promise.all(
    ['zh-TW', 'zh-HK', 'zh-CN'].map((language) =>
      workUnitAsyncStorage.run(store(language), async () => {
        await Promise.resolve();
        expect(getDisplayLanguage()).toBe(language);
        return [getRequestDisplayLanguage(), toDisplayText('视频软件')];
      }),
    ),
  );
  expect(tw).toEqual(['zh-TW', '影片軟體']);
  expect(hk).toEqual(['zh-HK', '視頻軟件']);
  expect(cn).toEqual(['zh-CN', '视频软件']);
  for (const language of ['zh-TW', 'zh-HK']) {
    workUnitAsyncStorage.run(store(language), () => toDisplayText('头发干杯'));
  }
  expect(buildDisplayCommon).toHaveBeenCalledTimes(1);
  expect(buildDisplayVariant).toHaveBeenCalledTimes(2);
  expect(buildDisplayVariant).toHaveBeenNthCalledWith(1, 'zh-TW');
  expect(buildDisplayVariant).toHaveBeenNthCalledWith(2, 'zh-HK');
  expect(getRequestDisplayLanguage()).toBe('zh-CN');
  expect(toDisplayText('视频软件')).toBe('视频软件');
});

it('uses Accept-Language when the cookie is absent and stays simplified outside requests', () => {
  registerDisplayText();
  workUnitAsyncStorage.run(store(undefined, 'zh-Hant'), () => {
    expect(getRequestDisplayLanguage()).toBe('zh-TW');
    expect(toDisplayText('软件')).toBe('軟體');
  });
  workUnitAsyncStorage.run(
    { type: 'prerender' } as Parameters<typeof workUnitAsyncStorage.run>[0],
    () => {
      expect(toDisplayText('软件')).toBe('软件');
    },
  );
});

it('exposes a changed request-store shape explicitly', () => {
  workUnitAsyncStorage.run(
    { type: 'request' } as Parameters<typeof workUnitAsyncStorage.run>[0],
    () => {
      expect(getRequestDisplayLanguage).toThrow('incompatible');
    },
  );
});
