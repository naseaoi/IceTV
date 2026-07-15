describe('游客网络请求拦截', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    global.fetch = jest.fn();
    jest.doMock('@/lib/auth.client', () => ({
      getAuthInfoFromBrowserCookie: () => null,
    }));
  });

  afterEach(() => {
    jest.dontMock('@/lib/auth.client');
  });

  it('不读取代理模式', async () => {
    const { getProxyModes } =
      require('@/lib/proxy-modes') as typeof import('@/lib/proxy-modes');

    await expect(getProxyModes()).resolves.toEqual({});
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('不上报播放路由统计', () => {
    const { reportSourceRouteStat } =
      require('@/lib/source-route-stats.client') as typeof import('@/lib/source-route-stats.client');

    reportSourceRouteStat('source-a', 'browser', true);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('不预取视频详情', () => {
    const { warmupForPlayback } =
      require('@/lib/video-prefetch') as typeof import('@/lib/video-prefetch');

    warmupForPlayback('source-a', 'video-a');
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
