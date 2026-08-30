import { webcrypto } from 'crypto';

// jest 的 jsdom 与 node 环境都不提供全局 crypto
export function installCryptoPolyfill() {
  if ((globalThis as { crypto?: Crypto }).crypto) return;

  Object.defineProperty(globalThis, 'crypto', {
    value: webcrypto,
    configurable: true,
  });
}
