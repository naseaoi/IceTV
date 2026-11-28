import {
  buildSourceRouteViews,
  formatRouteDetails,
  formatRouteSummary,
  getSourceRouteAdvice,
} from './sourceRouteView';

const stat = (
  routeMode: 'browser' | 'server',
  phase: 'primary' | 'fallback',
  successCount: number,
  failureCount: number,
) => ({ source: 's', routeMode, phase, successCount, failureCount });

describe('buildSourceRouteViews', () => {
  it('按首选与回落分开，失败原因按次数降序并算占比', () => {
    const views = buildSourceRouteViews(
      [
        stat('browser', 'primary', 6, 4),
        stat('server', 'fallback', 1, 3),
        stat('server', 'primary', 2, 0),
      ],
      [
        { source: 's', reason: 'timeout', failureCount: 1 },
        { source: 's', reason: 'http-403', failureCount: 3 },
        { source: 'other', reason: 'connection', failureCount: 2 },
      ],
    );
    expect(views.s.browser).toMatchObject({ totalCount: 10, successRate: 0.6 });
    expect(views.s.server).toMatchObject({ totalCount: 2, successRate: 1 });
    expect(views.s.serverFallback).toMatchObject({ successRate: 0.25 });
    expect(views.s.proxyFailureTotal).toBe(4);
    expect(views.s.proxyFailures?.map((item) => item.reason)).toEqual([
      'http-403',
      'timeout',
    ]);
    expect(views.other.proxyFailures?.[0]).toMatchObject({ share: 1 });
    expect(formatRouteSummary(views.s)).toBe('直连 60% · 代理 100% · 挽回 25%');
    expect(formatRouteDetails(views.s, 7)).toContain(
      '代理失败原因：上游拒绝 403 75%、超时 25%',
    );
  });
});

describe('getSourceRouteAdvice', () => {
  const view = (
    items: ReturnType<typeof stat>[],
    failures: { reason: 'http-403' | 'http-404'; failureCount: number }[] = [],
  ) =>
    buildSourceRouteViews(
      items,
      failures.map((item) => ({ source: 's', ...item })),
    ).s;

  it('自动模式下代理几乎挽回不了直连失败时建议直连，并带出主要原因', () => {
    const advice = getSourceRouteAdvice(
      'auto',
      view(
        [stat('browser', 'primary', 50, 30), stat('server', 'fallback', 1, 29)],
        [{ reason: 'http-403', failureCount: 29 }],
      ),
    );
    expect(advice).toMatchObject({ kind: 'mode', target: 'browser' });
    expect(advice?.detail).toContain('上游拒绝 403');
  });

  it('样本不足时不下结论', () => {
    expect(
      getSourceRouteAdvice('auto', view([stat('server', 'fallback', 0, 19)])),
    ).toBeNull();
  });

  it('直连大多失败而代理能挽回时建议代理', () => {
    expect(
      getSourceRouteAdvice(
        'auto',
        view([
          stat('browser', 'primary', 2, 28),
          stat('server', 'fallback', 25, 3),
        ]),
      ),
    ).toMatchObject({ kind: 'mode', target: 'server' });
  });

  it('固定代理被服务器出口拒绝时建议直连', () => {
    expect(
      getSourceRouteAdvice(
        'server',
        view(
          [stat('server', 'primary', 0, 30)],
          [{ reason: 'http-403', failureCount: 30 }],
        ),
      ),
    ).toMatchObject({ kind: 'mode', target: 'browser' });
  });

  it('固定代理成功率过低时建议自动', () => {
    expect(
      getSourceRouteAdvice('server', view([stat('server', 'primary', 2, 28)])),
    ).toMatchObject({ kind: 'mode', target: 'auto' });
  });

  it('两条线路都失败且多为 404 时提示源疑似失效而非改线路', () => {
    expect(
      getSourceRouteAdvice(
        'auto',
        view(
          [
            stat('browser', 'primary', 3, 27),
            stat('server', 'fallback', 0, 27),
          ],
          [{ reason: 'http-404', failureCount: 27 }],
        ),
      ),
    ).toMatchObject({ kind: 'dead' });
  });

  it('直连模式没有代理对照样本，不给建议', () => {
    expect(
      getSourceRouteAdvice(
        'browser',
        view([stat('browser', 'primary', 1, 40)]),
      ),
    ).toBeNull();
  });
});

it('relay samples describe the segment route and skip binary route advice', () => {
  const view = buildSourceRouteViews(
    [stat('browser', 'primary', 0, 30)],
    [{ source: 's', reason: 'http-404', failureCount: 30 }],
  ).s;
  expect(getSourceRouteAdvice('relay', view)).toBeNull();
  expect(formatRouteDetails(view, 7)).toContain('直连含清单中转');
});
