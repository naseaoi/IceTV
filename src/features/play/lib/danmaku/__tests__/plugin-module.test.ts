describe('loadDanmakuPluginModule', () => {
  afterEach(() => {
    jest.resetModules();
  });

  it('预热与建播放器共用同一次导入', async () => {
    let factoryCalls = 0;
    jest.doMock('artplayer-plugin-danmuku', () => {
      factoryCalls += 1;
      return { __esModule: true, default: jest.fn() };
    });
    const { loadDanmakuPluginModule } =
      await import('@/features/play/lib/danmaku/plugin');

    const first = loadDanmakuPluginModule();
    const second = loadDanmakuPluginModule();

    expect(second).toBe(first);
    await first;
    expect(factoryCalls).toBe(1);
  });

  it('导入失败后下次调用重新导入', async () => {
    let shouldFail = true;
    jest.doMock('artplayer-plugin-danmuku', () => {
      if (shouldFail) throw new Error('chunk load failed');
      return { __esModule: true, default: jest.fn() };
    });
    const { loadDanmakuPluginModule } =
      await import('@/features/play/lib/danmaku/plugin');

    await expect(loadDanmakuPluginModule()).rejects.toThrow(
      'chunk load failed',
    );
    shouldFail = false;
    await expect(loadDanmakuPluginModule()).resolves.toHaveProperty('default');
  });
});
