import {
  reportSourcePlayOutcome,
  reportSourceRouteStat,
  resetSourceRouteStatDedupeForTests,
} from '../source-route-stats.client';

jest.mock('@/lib/auth.client', () => ({
  getAuthInfoFromBrowserCookie: () => ({ username: 'alice' }),
}));

const originalFetch = global.fetch;
beforeEach(() => {
  resetSourceRouteStatDedupeForTests();
  jest.useFakeTimers();
  global.fetch = jest.fn().mockResolvedValue({ ok: true });
});
afterEach(() => {
  jest.runOnlyPendingTimers();
  jest.useRealTimers();
  global.fetch = originalFetch;
});

test('相邻线路与源结果合并一次 POST，保留各自事件时间和成败', async () => {
  reportSourceRouteStat('demo', 'browser', false, 'primary');
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
        phase: 'primary',
        success: false,
        eventAt: expect.any(Number),
      },
      outcome: { source: 'demo', success: true, eventAt: expect.any(Number) },
    },
  );
});

test('独立线路失败只报告线路，多个样本全部保留', () => {
  reportSourceRouteStat('demo', 'browser', false, 'primary');
  reportSourceRouteStat('demo', 'server', false, 'fallback');
  jest.runOnlyPendingTimers();
  const calls = (global.fetch as jest.Mock).mock.calls;
  expect(calls).toHaveLength(2);
  expect(calls.map((call) => JSON.parse(call[1].body))).toEqual([
    { stat: expect.objectContaining({ routeMode: 'browser', success: false }) },
    {
      stat: expect.objectContaining({
        routeMode: 'server',
        phase: 'fallback',
        success: false,
      }),
    },
  ]);
});

test('页面离开立即 keepalive flush 且后续定时器不重复发送', () => {
  reportSourceRouteStat('demo', 'server', true, 'primary');
  reportSourcePlayOutcome('demo', true);
  window.dispatchEvent(new Event('pagehide'));
  expect(global.fetch).toHaveBeenCalledTimes(1);
  expect((global.fetch as jest.Mock).mock.calls[0][1].keepalive).toBe(true);
  jest.runOnlyPendingTimers();
  expect(global.fetch).toHaveBeenCalledTimes(1);
});

test('同源同线路同结果 10 分钟内只报一次，结果或阶段不同照常上报', () => {
  reportSourceRouteStat('demo', 'browser', false, 'primary');
  reportSourceRouteStat('demo', 'browser', false, 'primary');
  reportSourceRouteStat('demo', 'browser', true, 'primary');
  reportSourceRouteStat('demo', 'browser', false, 'fallback');
  jest.runOnlyPendingTimers();
  expect(global.fetch).toHaveBeenCalledTimes(3);

  jest.advanceTimersByTime(10 * 60 * 1000);
  reportSourceRouteStat('demo', 'browser', false, 'primary');
  jest.runOnlyPendingTimers();
  expect(global.fetch).toHaveBeenCalledTimes(4);
});

test('线路样本被去重时，同源的播放结果仍然上报', () => {
  reportSourceRouteStat('demo', 'server', true, 'primary');
  jest.runOnlyPendingTimers();
  reportSourceRouteStat('demo', 'server', true, 'primary');
  reportSourcePlayOutcome('demo', true);
  jest.runOnlyPendingTimers();
  const calls = (global.fetch as jest.Mock).mock.calls;
  expect(calls).toHaveLength(2);
  expect(JSON.parse(calls[1][1].body)).toEqual({
    outcome: { source: 'demo', success: true, eventAt: expect.any(Number) },
  });
});
