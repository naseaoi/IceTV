/** @jest-environment node */

import { EventEmitter } from 'node:events';

import { installStreamPolyfills } from '@/app/api/test-utils/stream-polyfills';

import {
  fetchResponseThroughProxy,
  fetchStreamThroughProxy,
} from '../http-proxy-json';

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

function setup(buffered?: false): {
  socket: ReturnType<typeof createSocket>;
  result: ReturnType<typeof fetchStreamThroughProxy>;
};
function setup(buffered: true): {
  socket: ReturnType<typeof createSocket>;
  result: ReturnType<typeof fetchResponseThroughProxy>;
};
function setup(buffered = false) {
  const socket = createSocket();
  const request = Object.assign(new EventEmitter(), {
    setTimeout: jest.fn(),
    end: jest.fn(),
    destroy: jest.fn(),
  });
  mockRequest.mockReturnValue(request);
  mockTls.mockReturnValue(socket);
  const result = (
    buffered ? fetchResponseThroughProxy : fetchStreamThroughProxy
  )(new URL('https://example.com/epg'), new URL('http://proxy.example:80'), {
    timeoutMs: 1000,
    userAgent: 'test',
    maxBytes: 1024 * 1024,
    accept: '*/*',
  });
  request.emit('connect', { statusCode: 200 }, {});
  return { socket, result };
}

function createSocket() {
  return Object.assign(new EventEmitter(), {
    destroy: jest.fn(),
    setTimeout: jest.fn(),
    write: jest.fn(),
    pause: jest.fn(),
    resume: jest.fn(),
  });
}

it.each([false, true])(
  'buffered HTTPS verifies truncated body and decodes complete chunks (%s)',
  async (complete) => {
    const { socket, result } = setup(true);
    const assertion = complete
      ? expect(result).resolves.toMatchObject({ body: Buffer.from('abc') })
      : expect(result).rejects.toThrow('Truncated');
    socket.emit(
      'data',
      Buffer.from(
        `HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n3\r\nabc\r\n${complete ? '0\r\n\r\n' : ''}`,
      ),
    );
    socket.emit('end');
    await assertion;
  },
);

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

it('errors immediately on socket close without end and permits intentional cancellation', async () => {
  const first = setup();
  first.socket.emit(
    'data',
    Buffer.from('HTTP/1.1 200 OK\r\nContent-Length: 100\r\n\r\nabc'),
  );
  const read = new Response((await first.result).body).text();
  const assertion = expect(read).rejects.toThrow('Truncated');
  first.socket.emit('close');
  await assertion;
  const second = setup();
  second.socket.emit('data', Buffer.from('HTTP/1.1 200 OK\r\n\r\nabc'));
  await (await second.result).body.cancel();
  expect(() => second.socket.emit('close')).not.toThrow();
});

it.each([
  ['Content-Length: 5', 'abc', false],
  ['Content-Length: 3', 'abc', true],
  ['Transfer-Encoding: chunked', '3\r\nabc\r\n', false],
  ['Transfer-Encoding: chunked', '3\r\nabc\r\n0\r\n\r\n', true],
  ['Transfer-Encoding: chunked', '3\r\nabc\r\n0\r\nX-Test: yes\r\n\r\n', true],
] as const)(
  'validates response framing %s complete=%s',
  async (headers, body, complete) => {
    const { socket, result } = setup();
    socket.emit('data', Buffer.from(`HTTP/1.1 200 OK\r\n${headers}\r\n\r\n`));
    const response = await result;
    const read = new Response(response.body).text();
    const assertion = complete
      ? expect(read).resolves.toBe('abc')
      : expect(read).rejects.toThrow('Truncated');
    for (const byte of Buffer.from(body))
      socket.emit('data', Buffer.from([byte]));
    socket.emit('end');
    await assertion;
    if (complete) expect(socket.destroy).not.toHaveBeenCalled();
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
