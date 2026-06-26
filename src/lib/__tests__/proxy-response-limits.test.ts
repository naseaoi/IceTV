import { ReadableStream } from 'stream/web';
import { TextDecoder } from 'util';

import {
  assertContentLength,
  createLimitedReadableStream,
  readTextLimited,
  ResponseSizeLimitError,
} from '../proxy-response-limits';

function createResponse(body: string): Response {
  const bytes = Buffer.from(body, 'utf8');
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });

  return {
    headers: new Headers(),
    body: stream as unknown as ReadableStream<Uint8Array>,
    arrayBuffer: async () => bytes.buffer,
  } as unknown as Response;
}

describe('proxy response limits', () => {
  beforeAll(() => {
    Object.assign(globalThis, { ReadableStream, TextDecoder });
  });

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

  it('rejects streams that exceed the limit while forwarding', async () => {
    const response = createResponse('hello');
    const stream = createLimitedReadableStream(response.body, 4);
    const reader = stream!.getReader();

    await expect(reader.read()).rejects.toThrow(ResponseSizeLimitError);
  });
});
