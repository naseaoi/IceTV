import { installStreamPolyfills } from '@/app/api/test-utils/stream-polyfills';

import {
  assertContentLength,
  createLimitedReadableStream,
  readJsonLimited,
  readTextLimited,
  ResponseSizeLimitError,
} from '../proxy-response-limits';

installStreamPolyfills();

function createResponse(body: string): Response {
  return new Response(body);
}

describe('proxy response limits', () => {
  it('rejects content-length values over the limit', () => {
    const headers = new Headers({ 'content-length': '10' });

    expect(() => assertContentLength(headers, 9)).toThrow(
      ResponseSizeLimitError,
    );
  });

  it('reads bodies within the limit', async () => {
    const response = createResponse('hello');

    await expect(readTextLimited(response, 5)).resolves.toBe('hello');
  });

  it('rejects bodies that exceed the limit while reading', async () => {
    const response = createResponse('hello');

    await expect(readTextLimited(response, 4)).rejects.toThrow(
      ResponseSizeLimitError,
    );
  });

  it('cancels the upstream reader when streamed JSON exceeds the limit without Content-Length', async () => {
    const cancel = jest.fn();
    const chunks = ['{"ok":', 'true}'].map((chunk) =>
      new TextEncoder().encode(chunk),
    );
    let chunksSent = 0;
    const response = new Response(
      new ReadableStream<Uint8Array>(
        {
          pull(controller) {
            if (chunksSent < chunks.length) {
              controller.enqueue(chunks[chunksSent++]);
            } else {
              controller.close();
            }
          },
          cancel,
        },
        { highWaterMark: 0 },
      ),
    );
    expect(response.headers.has('content-length')).toBe(false);

    await expect(readJsonLimited(response, 10)).rejects.toThrow(
      ResponseSizeLimitError,
    );
    expect(chunksSent).toBe(2);
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('rejects streams that exceed the limit while forwarding', async () => {
    const response = createResponse('hello');
    const stream = createLimitedReadableStream(response.body, 4);
    const reader = stream!.getReader();

    await expect(reader.read()).rejects.toThrow(ResponseSizeLimitError);
  });
});
