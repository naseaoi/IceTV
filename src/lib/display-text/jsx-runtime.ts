import { jsx as reactJsx, jsxs as reactJsxs } from 'react/jsx-runtime';

import { toDisplayHostProps } from './host-props';

export type { JSX } from 'react/jsx-runtime';
export { Fragment } from 'react/jsx-runtime';

export const jsx: typeof reactJsx = (type, props, key) =>
  reactJsx(type, toDisplayHostProps(type, props), key);
export const jsxs: typeof reactJsxs = (type, props, key) =>
  reactJsxs(type, toDisplayHostProps(type, props), key);
