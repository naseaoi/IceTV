import { installWebPolyfills } from '@/app/api/test-utils/web-polyfills';

import { readResponseTextWithLimit } from '../response-text';

installWebPolyfills();

describe('readResponseTextWithLimit', () => {
  it('reads responses below the byte limit', async () => {
    const response = new Response('hello');

    await expect(readResponseTextWithLimit(response, 8)).resolves.toBe('hello');
  });

  it('rejects responses above the byte limit', async () => {
    const response = new Response('hello world');

    await expect(readResponseTextWithLimit(response, 5)).rejects.toThrow(
      '响应体超过大小限制',
    );
  });

  it('rejects oversized content length before reading', async () => {
    const response = new Response('hello', {
      headers: { 'content-length': '9' },
    });

    await expect(
      readResponseTextWithLimit(response, 5, '配置订阅'),
    ).rejects.toThrow('配置订阅超过大小限制');
  });
});
