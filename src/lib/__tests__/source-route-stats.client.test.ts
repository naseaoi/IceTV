import {
  reportSourcePlayOutcome,
  reportSourceRouteStat,
  reportSourceSmoothness,
  resetSourceRouteStatDedupeForTests,
} from '../source-route-stats.client';

jest.mock('@/lib/auth.client', () => ({
  getAuthInfoFromBrowserCookie: () => ({ username: 'alice' }),
}));

const smooth = {
  source: 'demo',
  routeMode: 'browser' as const,
  mediaType: 'hls' as const,
  watchMs: 60_000,
  stallMs: 2_000,
  stallCount: 1,
  unknownMs: 0,
  eventAt: 123,
};

test('smooth 与 stat/outcome 三类配对，同类增量完整保留', () => {
  reportSourceSmoothness(smooth);
  reportSourceRouteStat('demo', 'browser', true, 'primary');
  reportSourcePlayOutcome('demo', true);
  reportSourceSmoothness(smooth);
  jest.runOnlyPendingTimers();
  const bodies = (global.fetch as jest.Mock).mock.calls.map((call) =>
    JSON.parse(call[1].body),
  );
  expect(bodies).toHaveLength(2);
  expect(bodies[0]).toEqual({
    stat: expect.any(Object),
    outcome: expect.any(Object),
    smooth,
  });
  expect(bodies[1]).toEqual({ smooth });
});

test('全零增量静默，超过十分钟拆分且保持各项总量', () => {
  reportSourceSmoothness({ ...smooth, watchMs: 0, stallMs: 0, stallCount: 0 });
  jest.runOnlyPendingTimers();
  expect(global.fetch).not.toHaveBeenCalled();
  reportSourceSmoothness({ ...smooth, watchMs: 1_300_000 });
  window.dispatchEvent(new Event('pagehide'));
  const payloads = (global.fetch as jest.Mock).mock.calls.map(
    (call) => JSON.parse(call[1].body).smooth,
  );
  expect(payloads.map((p) => p.watchMs)).toEqual([600_000, 600_000, 100_000]);
  expect(payloads.reduce((sum, p) => sum + p.stallMs, 0)).toBe(2_000);
  expect(payloads.reduce((sum, p) => sum + p.stallCount, 0)).toBe(1);
});

test('卡顿密集或未知等待长于观看时拆包，符合服务端时长边界且完整保留增量', () => {
  reportSourceSmoothness({
    ...smooth,
    watchMs: 1_000,
    stallMs: 50_000,
    unknownMs: 60_000,
  });
  jest.runOnlyPendingTimers();
  const payloads = (global.fetch as jest.Mock).mock.calls.map(
    (call) => JSON.parse(call[1].body).smooth,
  );
  expect(payloads).toHaveLength(2);
  expect(
    payloads.every(
      (p) =>
        p.stallMs <= p.watchMs + 30_000 && p.unknownMs <= p.watchMs + 30_000,
    ),
  ).toBe(true);
  expect(payloads.reduce((sum, p) => sum + p.stallMs, 0)).toBe(50_000);
  expect(payloads.reduce((sum, p) => sum + p.unknownMs, 0)).toBe(60_000);
  expect(payloads.reduce((sum, p) => sum + p.stallCount, 0)).toBe(1);
});

test('隐藏状态中新产生的增量立即提交，不依赖 visibility 监听顺序', () => {
  const visibility = jest
    .spyOn(document, 'visibilityState', 'get')
    .mockReturnValue('hidden');
  reportSourceSmoothness(smooth);
  expect(global.fetch).toHaveBeenCalledTimes(1);
  expect((global.fetch as jest.Mock).mock.calls[0][1].keepalive).toBe(true);
  visibility.mockRestore();
});

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
