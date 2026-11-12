import {
  reportSourcePlayOutcome,
  reportSourceRouteStat,
} from '../source-route-stats.client';

jest.mock('@/lib/auth.client', () => ({
  getAuthInfoFromBrowserCookie: () => ({ username: 'alice' }),
}));

const originalFetch = global.fetch;
beforeEach(() => {
  jest.useFakeTimers();
  global.fetch = jest.fn().mockResolvedValue({ ok: true });
});
afterEach(() => {
  jest.runOnlyPendingTimers();
  jest.useRealTimers();
  global.fetch = originalFetch;
});

test('相邻线路与源结果合并一次 POST，保留各自事件时间和成败', async () => {
  reportSourceRouteStat('demo', 'browser', false);
  await Promise.resolve();
  reportSourcePlayOutcome('demo', true);
  expect(global.fetch).not.toHaveBeenCalled();
  jest.runOnlyPendingTimers();
  expect(global.fetch).toHaveBeenCalledTimes(1);
  expect(JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body)).toEqual(
    {
      stat: {
        source: 'demo',
        routeMode: 'browser',
        success: false,
        eventAt: expect.any(Number),
      },
      outcome: { source: 'demo', success: true, eventAt: expect.any(Number) },
    },
  );
});

test('独立线路失败只报告线路，多个样本全部保留', () => {
  reportSourceRouteStat('demo', 'browser', false);
  reportSourceRouteStat('demo', 'server', false);
  jest.runOnlyPendingTimers();
  const calls = (global.fetch as jest.Mock).mock.calls;
  expect(calls).toHaveLength(2);
  expect(calls.map((call) => JSON.parse(call[1].body))).toEqual([
    { stat: expect.objectContaining({ routeMode: 'browser', success: false }) },
    { stat: expect.objectContaining({ routeMode: 'server', success: false }) },
  ]);
});

test('页面离开立即 keepalive flush 且后续定时器不重复发送', () => {
  reportSourceRouteStat('demo', 'server', true);
  reportSourcePlayOutcome('demo', true);
  window.dispatchEvent(new Event('pagehide'));
  expect(global.fetch).toHaveBeenCalledTimes(1);
  expect((global.fetch as jest.Mock).mock.calls[0][1].keepalive).toBe(true);
  jest.runOnlyPendingTimers();
  expect(global.fetch).toHaveBeenCalledTimes(1);
});
