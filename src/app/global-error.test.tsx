import { act } from '@testing-library/react';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { type Root, createRoot, hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';

import GlobalError from '@/app/global-error';
import { type DisplayTextGlobals } from '@/lib/display-text';
import { DISPLAY_CONVERTER_SRC } from '@/lib/display-text/asset.generated';
import {
  buildDisplayCommon,
  buildDisplayVariant,
} from '@/lib/display-text/build';
import {
  createCompactCommon,
  createCompactConverter,
} from '@/lib/display-text/compact';

const commonData = buildDisplayCommon();
const twData = buildDisplayVariant('zh-TW');
const hkData = buildDisplayVariant('zh-HK');
const directory = mkdtempSync(path.join(tmpdir(), 'display-error-assets-'));
beforeAll(() => {
  execFileSync(process.execPath, [
    '-e',
    'require(process.argv[1]).generateDisplayConverter(process.argv[2], process.argv[3]).catch(error => { console.error(error); process.exitCode = 1; });',
    path.resolve('scripts/generate-display-converter.js'),
    directory,
    path.join(directory, 'asset.generated.ts'),
  ]);
});
afterAll(() => rmSync(directory, { recursive: true, force: true }));

jest.mock('@/lib/client-error-reporting', () => ({
  buildClientErrorReport: () => null,
  reportClientError: jest.fn(),
}));

const globals = globalThis as DisplayTextGlobals;
let root: Root | undefined;
afterEach(() => {
  if (root) act(() => root?.unmount());
  root = undefined;
  document.documentElement.lang = '';
  delete globals.__ICETV_DISPLAY_CONVERTER__;
});

it.each([
  ['zh-TW', twData],
  ['zh-HK', hkData],
] as const)(
  'keeps the error document language and text stable across commits (%s)',
  (language, data) => {
    document.documentElement.lang = language;
    globals.__ICETV_DISPLAY_CONVERTER__ = createCompactConverter(
      createCompactCommon(commonData),
      data,
    );
    const error = new Error('软件');
    const reset = jest.fn();
    root = createRoot(document);
    act(() => root?.render(<GlobalError error={error} reset={reset} />));
    expect(document.documentElement.lang).toBe(language);
    const first = document.querySelector('h1')?.textContent;
    expect(first).toBe(globals.__ICETV_DISPLAY_CONVERTER__('应用加载失败'));
    act(() =>
      root?.render(<GlobalError error={new Error('软件')} reset={reset} />),
    );
    expect(document.querySelector('h1')?.textContent).toBe(first);
    const script = document.querySelector('script');
    expect(script?.getAttribute('src')).toBe(DISPLAY_CONVERTER_SRC[language]);
    expect(script?.hasAttribute('async')).toBe(false);
    expect(script?.hasAttribute('defer')).toBe(false);
  },
);

it('hydrates a standalone error document after its synchronous dictionary loads', async () => {
  document.documentElement.lang = 'zh-TW';
  globals.__ICETV_DISPLAY_CONVERTER__ = createCompactConverter(
    createCompactCommon(commonData),
    twData,
  );
  const error = new Error('软件');
  const element = <GlobalError error={error} reset={jest.fn()} />;
  const markup = renderToString(element);
  delete globals.__ICETV_DISPLAY_CONVERTER__;
  document.open();
  document.write(markup);
  document.close();
  // jsdom does not fetch parser-blocking scripts: execute the actual generated asset before hydration.
  const source = readFileSync(
    path.join(directory, path.basename(DISPLAY_CONVERTER_SRC['zh-TW'])),
    'utf8',
  );
  new Function(source)();
  const recover = jest.fn();
  await act(async () => {
    root = hydrateRoot(document, element, { onRecoverableError: recover });
  });
  expect(recover).not.toHaveBeenCalled();
  expect(document.documentElement.lang).toBe('zh-TW');
  expect(document.querySelector('h1')?.textContent).toBe('應用載入失敗');
});
