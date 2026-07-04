import { TextDecoder } from 'util';

import { installWebPolyfills } from '@/app/api/test-utils/web-polyfills';

import { decodeConfigSubscriptionContent } from '../config-subscription';

installWebPolyfills();
if (!global.TextDecoder) {
  global.TextDecoder = TextDecoder as typeof global.TextDecoder;
}

describe('config subscription helpers', () => {
  it('decodes base58 content with surrounding whitespace', async () => {
    await expect(
      decodeConfigSubscriptionContent('\nXXzHTG4BdLipah2\n'),
    ).resolves.toBe('{"ok":true}');
  });
});
