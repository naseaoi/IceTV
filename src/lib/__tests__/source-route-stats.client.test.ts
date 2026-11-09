import {
  reportSourcePlayOutcome,
  reportSourceRouteStat,
} from '../source-route-stats.client';

jest.mock('@/lib/auth.client', () => ({
  getAuthInfoFromBrowserCookie: () => ({ username: 'alice' }),
}));

test('线路统计与最终源健康分别发送，不隐式捆绑', () => {
  const originalFetch = global.fetch;
  const fetchMock = jest.fn().mockResolvedValue({ ok: true });
  global.fetch = fetchMock;
  try {
    reportSourceRouteStat('demo', 'browser', false);
    reportSourcePlayOutcome('demo', true);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      stat: {
        source: 'demo',
        routeMode: 'browser',
        success: false,
        eventAt: expect.any(Number),
      },
    });
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({
      outcome: { source: 'demo', success: true, eventAt: expect.any(Number) },
    });
  } finally {
    global.fetch = originalFetch;
  }
});
