/** @jest-environment node */

import { EventEmitter } from 'node:events';

import { installStreamPolyfills } from '@/app/api/test-utils/stream-polyfills';

import { fetchStreamThroughProxy } from '../http-proxy-json';

installStreamPolyfills();
const mockRequest = jest.fn();
const mockTls = jest.fn();
jest.mock('node:http', () => ({
  request: (...args: unknown[]) => mockRequest(...args),
}));
jest.mock('node:https', () => ({
  request: (...args: unknown[]) => mockRequest(...args),
}));
jest.mock('node:tls', () => ({
  connect: (...args: unknown[]) => mockTls(...args),
}));

function setup() {
  const socket = Object.assign(new EventEmitter(), {
    destroy: jest.fn(),
    setTimeout: jest.fn(),
    write: jest.fn(),
    pause: jest.fn(),
    resume: jest.fn(),
  });
  const request = Object.assign(new EventEmitter(), {
    setTimeout: jest.fn(),
    end: jest.fn(),
    destroy: jest.fn(),
  });
  mockRequest.mockReturnValue(request);
  mockTls.mockReturnValue(socket);
  const result = fetchStreamThroughProxy(
    new URL('https://example.com/epg'),
    new URL('http://proxy.example:80'),
    {
      timeoutMs: 1000,
      userAgent: 'test',
      maxBytes: 1024 * 1024,
      accept: '*/*',
    },
  );
  request.emit('connect', { statusCode: 200 }, {});
  return { socket, result };
}

it.each([false, true])(
  '拒绝超出 64 KiB 的响应头（带结束符=%s）',
  async (terminated) => {
    const { socket, result } = setup();
    const rejection = expect(result).rejects.toThrow('代理响应头过大');
    socket.emit('data', Buffer.from('HTTP/1.1 200 OK\r\nX-Fill: '));
    socket.emit(
      'data',
      Buffer.from('a'.repeat(64 * 1024) + (terminated ? '\r\n\r\n' : '')),
    );
    await rejection;
    expect(socket.destroy).toHaveBeenCalledTimes(1);
  },
);

it('响应头分隔符跨分片且正文大于头上限时完整保留正文', async () => {
  const { socket, result } = setup();
  socket.emit(
    'data',
    Buffer.from('HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\n\r'),
  );
  const payload = 'x'.repeat(80 * 1024);
  socket.emit('data', Buffer.from('\n' + payload));
  socket.emit('end');
  const response = await result;
  const reader = response.body.getReader();
  expect(Buffer.from((await reader.read()).value!).toString()).toBe(payload);
  expect((await reader.read()).done).toBe(true);
  expect(socket.destroy).not.toHaveBeenCalled();
});
