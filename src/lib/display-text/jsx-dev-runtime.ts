import { jsxDEV as reactJsxDEV } from 'react/jsx-dev-runtime';

import { toDisplayHostProps } from './host-props';

export type { JSX } from 'react/jsx-dev-runtime';
export { Fragment } from 'react/jsx-dev-runtime';

export const jsxDEV: typeof reactJsxDEV = (
  type,
  props,
  key,
  isStatic,
  source,
  self,
) =>
  reactJsxDEV(
    type,
    toDisplayHostProps(type, props),
    key,
    isStatic,
    source,
    self,
  );
