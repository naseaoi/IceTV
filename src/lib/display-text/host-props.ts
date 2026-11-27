import Image from 'next/image';
import Link from 'next/link';
import { Fragment } from 'react';

import { getDisplayTextConverter } from './index';

const DISPLAY_ATTRIBUTES = [
  'placeholder',
  'title',
  'alt',
  'aria-label',
  'aria-valuetext',
  'aria-placeholder',
  'aria-description',
] as const;
const LINK_ATTRIBUTES = ['title', 'aria-label'] as const;
const IMAGE_ATTRIBUTES = ['alt'] as const;
const RAW_CHILDREN_TAGS = new Set(['script', 'style', 'textarea']);

export function toDisplayHostProps(type: unknown, props: unknown): unknown {
  const host = typeof type === 'string';
  // Next 内部创建的 a/img 不经过本项目 JSX 运行时；仅按这两个组件的身份处理显示字段。
  if (
    (!host && type !== Fragment && type !== Link && type !== Image) ||
    !props ||
    typeof props !== 'object'
  )
    return props;
  const convert = getDisplayTextConverter();
  if (!convert) return props;
  const original = props as Record<string, unknown>;
  let result = original;
  const update = (key: string, value: unknown) => {
    if (value === original[key]) return;
    if (result === original) result = { ...original };
    result[key] = value;
  };
  const children = (value: unknown): unknown => {
    if (typeof value === 'string') return convert(value);
    if (!Array.isArray(value)) return value;
    const converted = value.map(children);
    return converted.some((item, index) => item !== value[index])
      ? converted
      : value;
  };
  if (
    type === Fragment ||
    type === Link ||
    (host && !RAW_CHILDREN_TAGS.has(type))
  ) {
    update('children', children(original.children));
  }
  const attributes = host
    ? DISPLAY_ATTRIBUTES
    : type === Link
      ? LINK_ATTRIBUTES
      : type === Image
        ? IMAGE_ATTRIBUTES
        : [];
  for (const key of attributes) {
    if (typeof original[key] === 'string') update(key, convert(original[key]));
  }
  return result;
}
