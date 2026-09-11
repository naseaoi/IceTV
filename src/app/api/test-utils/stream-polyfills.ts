import { installWebPolyfills } from '@/app/api/test-utils/web-polyfills';

export function installStreamPolyfills() {
  installWebPolyfills();
  const { TextEncoder, TextDecoder } = require('node:util');
  Object.assign(globalThis, require('node:stream/web'), {
    TextEncoder,
    TextDecoder,
  });
  const {
    Headers,
    Request,
    Response,
  } = require('next/dist/compiled/@edge-runtime/primitives/fetch');
  Object.assign(globalThis, { Headers, Request, Response });
}
