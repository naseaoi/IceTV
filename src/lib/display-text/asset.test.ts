/** @jest-environment node */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runInNewContext } from 'node:vm';

import { DISPLAY_CONVERTER_SRC } from './asset.generated';
import { buildDisplayCommon, buildDisplayVariant } from './build';
import { createCompactCommon, createCompactConverter } from './compact';

const directory = mkdtempSync(path.join(tmpdir(), 'display-assets-'));
const manifest = path.join(directory, 'asset.generated.ts');
function generate() {
  execFileSync(process.execPath, [
    '-e',
    'require(process.argv[1]).generateDisplayConverter(process.argv[2], process.argv[3]).catch(error => { console.error(error); process.exitCode = 1; });',
    path.resolve('scripts/generate-display-converter.js'),
    directory,
    manifest,
  ]);
}

beforeAll(generate);
afterAll(() => rmSync(directory, { recursive: true, force: true }));

it('keeps the committed manifest current, removes stale assets and leaves repeat builds unchanged', () => {
  expect(readFileSync(manifest, 'utf8')).toBe(
    readFileSync(
      path.resolve('src/lib/display-text/asset.generated.ts'),
      'utf8',
    ),
  );
  const files = readdirSync(directory);
  const before = files.map(
    (file) => statSync(path.join(directory, file)).mtimeMs,
  );
  writeFileSync(path.join(directory, 'opencc-stale.js'), 'stale');
  writeFileSync(path.join(directory, 'unrelated.js'), 'keep');
  mkdirSync(path.join(directory, 'opencc-directory.js'));
  generate();
  expect(readdirSync(directory).sort()).toEqual(
    [...files, 'unrelated.js', 'opencc-directory.js'].sort(),
  );
  expect(
    files.map((file) => statSync(path.join(directory, file)).mtimeMs),
  ).toEqual(before);
  expect(readFileSync(path.join(directory, 'unrelated.js'), 'utf8')).toBe(
    'keep',
  );
});

it.each([
  ['zh-TW', '影片軟體'],
  ['zh-HK', '視頻軟件'],
] as const)(
  'initializes the fingerprinted regional asset synchronously (%s)',
  (lang, expected) => {
    const src = DISPLAY_CONVERTER_SRC[lang];
    const source = readFileSync(
      path.join(directory, path.basename(src)),
      'utf8',
    );
    const hash = createHash('sha256').update(source).digest('hex').slice(0, 16);
    expect(src).toContain(hash);
    const context = {
      document: { documentElement: { lang } },
      __ICETV_DISPLAY_CONVERTER__: undefined as
        | undefined
        | ((text: string) => string),
    };
    runInNewContext(source, context);
    expect(context.__ICETV_DISPLAY_CONVERTER__?.('视频软件')).toBe(expected);
    const server = createCompactConverter(
      createCompactCommon(buildDisplayCommon()),
      buildDisplayVariant(lang),
    );
    for (const input of ['头发干杯', '⿰马龙', '网络出租车软件', '神社𠮷']) {
      expect(context.__ICETV_DISPLAY_CONVERTER__?.(input)).toBe(server(input));
    }
    const simplified = {
      document: { documentElement: { lang: 'zh-CN' } },
      __ICETV_DISPLAY_CONVERTER__: undefined,
    };
    runInNewContext(source, simplified);
    expect(simplified.__ICETV_DISPLAY_CONVERTER__).toBeUndefined();
    const warn = jest.fn();
    expect(() => runInNewContext(source, { console: { warn } })).not.toThrow();
    expect(warn).toHaveBeenCalledTimes(1);
  },
);
