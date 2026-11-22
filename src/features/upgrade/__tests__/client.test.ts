/** @jest-environment node */
import { installStreamPolyfills } from '@/app/api/test-utils/stream-polyfills';

import {
  isUpdaterConfigured,
  normalizeUpdaterStatus,
  requestUpdater,
  UpdaterConflictError,
} from '../client.server';

installStreamPolyfills();
const initialEnv = {
  url: process.env.UPDATER_URL,
  token: process.env.UPDATER_TOKEN,
};
const initialFetch = global.fetch;
const fetchMock = jest.fn();
beforeEach(() => {
  process.env.UPDATER_URL = 'http://updater:9330';
  process.env.UPDATER_TOKEN = 'test-token';
  global.fetch = fetchMock;
  fetchMock.mockReset();
});
afterAll(() => {
  if (initialEnv.url === undefined) delete process.env.UPDATER_URL;
  else process.env.UPDATER_URL = initialEnv.url;
  if (initialEnv.token === undefined) delete process.env.UPDATER_TOKEN;
  else process.env.UPDATER_TOKEN = initialEnv.token;
  global.fetch = initialFetch;
});
it('规范化字段并剥离额外数据', () => {
  expect(
    normalizeUpdaterStatus({
      capable: true,
      secret: 'discard',
      target: {
        container: ' app ',
        project: 'project',
        service: 'app',
        image: 'image:latest',
        currentVersion: null,
        extra: true,
      },
      job: {
        phase: 'pulled',
        pulledVersion: ' 1.0.0 ',
        message: 'done\n',
        startedAt: 1,
        updatedAt: 2,
        extra: true,
      },
    }),
  ).toEqual({
    capable: true,
    target: {
      container: 'app',
      project: 'project',
      service: 'app',
      image: 'image:latest',
      currentVersion: null,
    },
    job: {
      phase: 'pulled',
      pulledVersion: '1.0.0',
      message: 'done',
      startedAt: 1,
      updatedAt: 2,
    },
  });
});
it.each([
  null,
  [],
  {},
  { capable: 1, job: { phase: 'idle' } },
  { capable: true, job: { phase: 'unknown' } },
  { capable: true, job: { phase: 'idle', updatedAt: -1 } },
  { capable: true, job: { phase: 'idle', message: {} } },
  { capable: true, job: { phase: 'idle' }, target: {} },
])('拒绝非法响应 %p', (input) => {
  expect(() => normalizeUpdaterStatus(input)).toThrow();
});
it('未配置服务时不发请求', async () => {
  delete process.env.UPDATER_TOKEN;
  expect(isUpdaterConfigured()).toBe(false);
  await expect(requestUpdater('status')).rejects.toThrow();
  expect(fetchMock).not.toHaveBeenCalled();
});
it.each(['status', 'pull', 'restart'] as const)(
  '请求 %s 携带 token 且禁止重定向',
  async (action) => {
    const status = { capable: true, job: { phase: 'idle' } };
    fetchMock.mockResolvedValue(Response.json(status));
    await expect(requestUpdater(action)).resolves.toEqual(status);
    expect(fetchMock).toHaveBeenCalledWith(
      new URL(`http://updater:9330/${action}`),
      expect.objectContaining({
        method: action === 'status' ? 'GET' : 'POST',
        headers: { Authorization: 'Bearer test-token' },
        redirect: 'error',
        cache: 'no-store',
      }),
    );
  },
);
it('409 转为固定可展示错误', async () => {
  fetchMock.mockResolvedValue(new Response('private failure', { status: 409 }));
  await expect(requestUpdater('pull')).rejects.toBeInstanceOf(
    UpdaterConflictError,
  );
});
it('拒绝超限正文', async () => {
  fetchMock.mockResolvedValue(new Response(' '.repeat(65537)));
  await expect(requestUpdater('status')).rejects.toThrow(
    'Response body too large',
  );
});
it.each([
  ['status', 5000],
  ['pull', 15000],
] as const)('%s 在超时后终止', async (action, timeout) => {
  jest.useFakeTimers();
  try {
    fetchMock.mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener('abort', () =>
            reject(new Error('aborted')),
          );
        }),
    );
    const pending = expect(requestUpdater(action)).rejects.toThrow('aborted');
    jest.advanceTimersByTime(timeout);
    await pending;
  } finally {
    jest.useRealTimers();
  }
});
