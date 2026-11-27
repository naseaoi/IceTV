/** @jest-environment node */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { Converter } from 'opencc-js/cn2t';
import ts from 'typescript';

import { buildDisplayCommon, buildDisplayVariant } from './build';
import { createCompactCommon, createCompactConverter } from './compact';

const commonData = buildDisplayCommon();
const twData = buildDisplayVariant('zh-TW');
const hkData = buildDisplayVariant('zh-HK');

function collectCorpus() {
  const strings: string[] = [];
  let files = 0;
  function visitDirectory(directory: string) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) visitDirectory(file);
      else if (/\.[cm]?[jt]sx?$/.test(entry.name)) {
        files++;
        const source = ts.createSourceFile(
          file,
          readFileSync(file, 'utf8'),
          ts.ScriptTarget.Latest,
          true,
        );
        function visit(node: ts.Node) {
          if (
            ts.isStringLiteralLike(node) ||
            ts.isTemplateHead(node) ||
            ts.isTemplateMiddle(node) ||
            ts.isTemplateTail(node) ||
            ts.isJsxText(node)
          ) {
            if (/\p{Script=Han}/u.test(node.text)) strings.push(node.text);
          }
          ts.forEachChild(node, visit);
        }
        visit(source);
      }
    }
  }
  visitDirectory(path.resolve('src'));
  const titles = [
    '软件工程师的异世界生活',
    '头文字D：最终季',
    '后宫·甄嬛传',
    '干物妹！小埋',
    '进击的巨人 最终季 完结篇',
    '龙猫（国语配音）',
    '千与千寻',
    '数码宝贝：最后的进化',
    '复仇者联盟4：终局之战',
    '银河护卫队3',
    '你好，李焕英',
    '长安三万里',
    '台风少年：后台风云',
    '网络奇缘：视频软件',
    '一发千钧与头发',
    '鼠标与土豆的故事',
    '互联网时代：出租车司机',
    '重庆森林',
    '哪吒之魔童闹海',
    '鬼灭之刃 无限城篇',
    '⿰马龙 ⿱⿰马龙云 ⿲马龙云 ⿰马',
    '神﨑神社𠀀𠮷𰻝',
    '发型发展头发干杯干燥',
  ];
  console.info(
    `Display equivalence corpus: ${files} source files, ${strings.length} Chinese literals/JSX/template parts, CHANGELOG, ${titles.length} samples`,
  );
  return [
    ...strings,
    readFileSync(path.resolve('CHANGELOG.md'), 'utf8'),
    ...titles,
  ];
}

const common = createCompactCommon(commonData);
const corpus = collectCorpus();
it.each([
  ['twp', twData],
  ['hk', hkData],
] as const)(
  'matches OpenCC byte-for-byte for the complete source corpus (%s)',
  (to, data) => {
    const compact = createCompactConverter(common, data);
    const reference = Converter({ from: 'cn', to });
    for (const input of corpus) {
      const actual = compact(input);
      const expected = reference(input);
      if (actual !== expected)
        expect({ input, actual }).toEqual({ input, actual: expected });
    }
  },
  60000,
);

it.each([
  ['twp', twData],
  ['hk', hkData],
] as const)(
  'matches every dictionary key and adjacent phrase boundaries (%s)',
  (to, data) => {
    const compact = createCompactConverter(common, data);
    const reference = Converter({ from: 'cn', to });
    const entries = [
      ...commonData.normalization,
      ...commonData.conversion,
      ...data,
    ].flatMap((group) =>
      group.entries.split('|').map((entry) => entry.split(' ')[0]),
    );
    for (let i = 0; i < entries.length; i++) {
      const input = entries[i] + entries[(i + 1) % entries.length];
      const actual = compact(input);
      const expected = reference(input);
      if (actual !== expected)
        expect({ input, actual }).toEqual({ input, actual: expected });
    }
  },
  60000,
);
