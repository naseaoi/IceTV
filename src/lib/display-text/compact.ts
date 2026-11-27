export type PackedDisplayGroup = { entries: string; maxLength: number };
export type PackedDisplayCommon = {
  normalization: PackedDisplayGroup[];
  conversion: PackedDisplayGroup[];
};
type Group = {
  dictionary: Map<string, string>;
  segmentation: Set<string>;
  maxLength: number;
  prefixLengths: Map<number, number>;
};

function unpack(data: PackedDisplayGroup): Group {
  const dictionary = new Map<string, string>();
  const segmentation = new Set<string>();
  const prefixLengths = new Map<number, number>();
  for (const entry of data.entries.split('|')) {
    const [key, value, segment] = entry.split(' ');
    dictionary.set(key, value);
    const prefix = key.codePointAt(0)!;
    prefixLengths.set(
      prefix,
      Math.max(prefixLengths.get(prefix) ?? 0, key.length),
    );
    if (segment) segmentation.add(key);
  }
  return { dictionary, segmentation, maxLength: data.maxLength, prefixLengths };
}

// OpenCC treats a complete ideographic description sequence as one unmatched unit.
function sequenceEnd(text: string, start: number): number {
  const cp = text.codePointAt(start)!;
  const arity =
    cp >= 0x2ff0 && cp <= 0x2fff ? (cp === 0x2ff2 || cp === 0x2ff3 ? 3 : 2) : 0;
  if (!arity) return 0;
  let end = start + 1;
  for (let i = 0; i < arity; i++) {
    if (end >= text.length) return 0;
    end =
      sequenceEnd(text, end) || end + (text.codePointAt(end)! > 0xffff ? 2 : 1);
  }
  return end;
}

function scan(text: string, group: Group, segment = false): string[] {
  const result: string[] = [];
  let original = 0;
  let position = 0;
  while (position < text.length) {
    let matched = false;
    const maxLength = group.prefixLengths.get(text.codePointAt(position)!) ?? 0;
    for (
      let length = Math.min(maxLength, group.maxLength, text.length - position);
      length > 0;
      length--
    ) {
      const key = text.slice(position, position + length);
      const value = segment
        ? group.segmentation.has(key)
          ? key
          : undefined
        : group.dictionary.get(key);
      if (value === undefined) continue;
      if (original < position) result.push(text.slice(original, position));
      result.push(value);
      position += length;
      original = position;
      matched = true;
      break;
    }
    if (!matched)
      position =
        sequenceEnd(text, position) ||
        position + (text.codePointAt(position)! > 0xffff ? 2 : 1);
  }
  if (original < text.length) result.push(text.slice(original));
  return result;
}

export function createCompactCommon(data: PackedDisplayCommon) {
  return {
    normalization: data.normalization.map(unpack),
    conversion: data.conversion.map(unpack),
  };
}

export function createCompactConverter(
  common: ReturnType<typeof createCompactCommon>,
  variant: PackedDisplayGroup[],
): (text: string) => string {
  const groups = [...common.conversion, ...variant.map(unpack)];
  return (text) => {
    for (const group of common.normalization) text = scan(text, group).join('');
    // Both regional presets segment on the shared simplified phrase group before conversion.
    let segments = scan(text, common.conversion[0], true);
    for (const group of groups)
      segments = segments.map((part) => scan(part, group).join(''));
    return segments.join('');
  };
}
