import { installStreamPolyfills } from '@/app/api/test-utils/stream-polyfills';

import { readResponseTextWithLimit } from '../response-text';

installStreamPolyfills();

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
    const cancel = jest.fn().mockRejectedValue(new Error('cancel failed'));
    const response = new Response(new ReadableStream({ cancel }), {
      headers: { 'content-length': '9' },
    });

    await expect(
      readResponseTextWithLimit(response, 5, '配置订阅'),
    ).rejects.toThrow('配置订阅超过大小限制');
    expect(cancel).toHaveBeenCalledTimes(1);
  });
});
