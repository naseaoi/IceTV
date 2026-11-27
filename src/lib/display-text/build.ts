import assert from 'node:assert/strict';
import { Locale } from 'opencc-js/cn2t';

import type { PackedDisplayCommon, PackedDisplayGroup } from './compact';

type Dictionary = string | readonly (readonly [string, string])[];
type DictionaryGroup = readonly Dictionary[];
type Preset = {
  normalizationChain: readonly DictionaryGroup[];
  segmentation: DictionaryGroup;
  conversionChain: readonly DictionaryGroup[];
};

function merge(group: DictionaryGroup): Map<string, string> {
  const result = new Map<string, string>();
  // Trie.loadDictGroup reverses dictionaries: the first dictionary wins duplicate keys.
  for (const dictionary of [...group].reverse()) {
    const entries =
      typeof dictionary === 'string'
        ? dictionary.split('|').map((entry) => entry.split(' '))
        : dictionary;
    for (const [key, value] of entries) result.set(key, value);
  }
  return result;
}

function pack(
  group: DictionaryGroup,
  segmentation = new Map<string, string>(),
): PackedDisplayGroup {
  const dictionary = merge(group);
  for (const key of segmentation.keys()) assert(dictionary.has(key));
  return {
    entries: [...dictionary]
      .map(
        ([key, value]) => `${key} ${value}${segmentation.has(key) ? ' 1' : ''}`,
      )
      .join('|'),
    maxLength: Math.max(...[...dictionary.keys()].map((key) => key.length)),
  };
}

function presets() {
  // OpenCC 1.4.2 declarations omit normalizationChain and type segmentation as a single dictionary.
  const { s2twp: tw, s2hk: hk } = Locale.configs as unknown as Record<
    string,
    Preset
  >;
  // Fail on preset topology changes rather than silently dropping normalization or segmentation.
  assert.deepEqual(tw.normalizationChain, hk.normalizationChain);
  assert.deepEqual(tw.segmentation, hk.segmentation);
  assert.deepEqual(tw.conversionChain[0], hk.conversionChain[0]);
  return { tw, hk };
}

export function buildDisplayCommon(): PackedDisplayCommon {
  const { tw } = presets();
  return {
    normalization: tw.normalizationChain.map((group) => pack(group)),
    conversion: [pack(tw.conversionChain[0], merge(tw.segmentation))],
  };
}

export function buildDisplayVariant(
  language: 'zh-TW' | 'zh-HK',
): PackedDisplayGroup[] {
  const { tw, hk } = presets();
  return (language === 'zh-HK' ? hk : tw).conversionChain
    .slice(1)
    .map((group) => pack(group));
}
