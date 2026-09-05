import {
  applyDanmakuHeatmapVisibility,
  bindDanmakuLoaded,
  bindDanmakuSettingPersistence,
  ensureDanmakuLoaded,
  markDanmakuContextAttached,
  reloadDanmaku,
} from '@/features/play/lib/danmaku/attach';
import {
  type DanmakuLoadContext,
  loadDanmakuForEpisode,
} from '@/features/play/lib/danmaku/resolve';

jest.mock('@/features/play/lib/danmaku/resolve', () => ({
  loadDanmakuForEpisode: jest.fn(),
}));

const mockLoadDanmakuForEpisode = loadDanmakuForEpisode as jest.MockedFunction<
  typeof loadDanmakuForEpisode
>;

type Handler = (...args: never[]) => unknown;

function createPlayerWithHandlers() {
  const handlers = new Map<string, Handler>();
  const player = {
    on(event: never, handler: Handler) {
      handlers.set(String(event), handler);
    },
  };
  return { player, handlers };
}

describe('bindDanmakuSettingPersistence', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('从关闭切换到开启时持久化并触发一次重载', () => {
    const reload = jest.fn();
    const onEnabledChange = jest.fn();
    const enabledRef = { current: false };
    const { player, handlers } = createPlayerWithHandlers();

    bindDanmakuSettingPersistence(player, {
      enabledRef,
      onEnabledChange,
      onEnable: reload,
    });

    void handlers.get('artplayerPluginDanmuku:show')?.();
    expect(enabledRef.current).toBe(true);
    expect(onEnabledChange).toHaveBeenCalledWith(true);
    expect(reload).toHaveBeenCalledTimes(1);

    void handlers.get('artplayerPluginDanmuku:show')?.();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('关闭时立即持久化关闭状态', () => {
    const enabledRef = { current: true };
    const onEnabledChange = jest.fn();
    const { player, handlers } = createPlayerWithHandlers();

    bindDanmakuSettingPersistence(player, { enabledRef, onEnabledChange });
    void handlers.get('artplayerPluginDanmuku:hide')?.();

    expect(enabledRef.current).toBe(false);
    expect(onEnabledChange).toHaveBeenCalledWith(false);
  });
});

describe('applyDanmakuHeatmapVisibility', () => {
  it('隐藏时保留容器尺寸，重新开启时恢复可见', () => {
    const heatmap = document.createElement('div');
    heatmap.style.display = 'none';
    const player = { controls: { heatmap } };

    applyDanmakuHeatmapVisibility(player, false);
    expect(heatmap.style.display).toBe('');
    expect(heatmap.style.visibility).toBe('hidden');

    applyDanmakuHeatmapVisibility(player, true);
    expect(heatmap.style.visibility).toBe('');
  });
});

describe('bindDanmakuLoaded', () => {
  it('回传插件实际装载的队列数量', () => {
    const { player, handlers } = createPlayerWithHandlers();
    const onLoaded = jest.fn();

    bindDanmakuLoaded(player, onLoaded);
    (
      handlers.get('artplayerPluginDanmuku:loaded') as unknown as (
        items: unknown,
      ) => void
    )?.([{ text: 'a' }, { text: 'b' }]);

    expect(onLoaded).toHaveBeenCalledWith(2);
  });

  it('插件未提供队列时按零条处理', () => {
    const { player, handlers } = createPlayerWithHandlers();
    const onLoaded = jest.fn();

    bindDanmakuLoaded(player, onLoaded);
    (
      handlers.get('artplayerPluginDanmuku:loaded') as unknown as (
        items: unknown,
      ) => void
    )?.(undefined);

    expect(onLoaded).toHaveBeenCalledWith(0);
  });
});

const loadContext: DanmakuLoadContext = {
  source: 'source-a',
  videoId: 'video-a',
  episodeIndex: 0,
  searchTitle: '测试视频',
  searchYear: '2026',
};

function createDanmakuPlayer() {
  const option = {} as { danmuku?: unknown };
  const api = {
    load: jest.fn(async () => {
      const loader = option.danmuku;
      if (typeof loader === 'function') {
        await (loader as () => Promise<unknown>)();
      }
    }),
    reset: jest.fn(),
    option,
  };
  return {
    api,
    player: { plugins: { artplayerPluginDanmuku: api } },
  };
}

describe('reloadDanmaku', () => {
  beforeEach(() => {
    mockLoadDanmakuForEpisode.mockReset().mockResolvedValue([]);
  });

  it('同一播放器与上下文已挂载时不重复加载', async () => {
    const { player, api } = createDanmakuPlayer();
    markDanmakuContextAttached(player, loadContext);

    await reloadDanmaku(player, loadContext, { current: true });

    expect(api.load).not.toHaveBeenCalled();
  });

  it('已加载后关闭再开启时直接显示现有队列', async () => {
    const { player, api } = createDanmakuPlayer();
    const enabledRef = { current: true };
    markDanmakuContextAttached(player, loadContext, true);

    await ensureDanmakuLoaded(player, loadContext, enabledRef);

    expect(api.load).not.toHaveBeenCalled();
    expect(mockLoadDanmakuForEpisode).not.toHaveBeenCalled();
  });

  it('初始关闭后首次开启时恰好补载一次且复用数据缓存', async () => {
    const { player, api } = createDanmakuPlayer();
    const enabledRef = { current: false };
    markDanmakuContextAttached(player, loadContext, false);
    enabledRef.current = true;

    await ensureDanmakuLoaded(player, loadContext, enabledRef);
    await ensureDanmakuLoaded(player, loadContext, enabledRef);

    expect(api.load).toHaveBeenCalledTimes(1);
    expect(mockLoadDanmakuForEpisode).toHaveBeenCalledTimes(1);
    expect(mockLoadDanmakuForEpisode.mock.calls[0][1]()).toBe(true);
    expect(mockLoadDanmakuForEpisode).toHaveBeenCalledWith(
      loadContext,
      expect.any(Function),
      { forceRefresh: false, onError: expect.any(Function) },
    );
  });

  it('关闭期间切集会清空旧队列，重新开启后只补载新集', async () => {
    const { player, api } = createDanmakuPlayer();
    const enabledRef = { current: false };
    const nextContext = { ...loadContext, episodeIndex: 1 };
    markDanmakuContextAttached(player, loadContext, true);

    await reloadDanmaku(player, nextContext, enabledRef);
    enabledRef.current = true;
    await ensureDanmakuLoaded(player, nextContext, enabledRef);

    expect(api.load).toHaveBeenCalledTimes(2);
    expect(mockLoadDanmakuForEpisode).toHaveBeenCalledTimes(2);
    expect(mockLoadDanmakuForEpisode.mock.calls[0][1]()).toBe(false);
    expect(mockLoadDanmakuForEpisode.mock.calls[1][1]()).toBe(true);
    expect(mockLoadDanmakuForEpisode.mock.calls[1][0]).toEqual(nextContext);
    expect(mockLoadDanmakuForEpisode.mock.calls[1][2]).toEqual({
      forceRefresh: false,
      onError: expect.any(Function),
    });
  });

  it('手动更换弹幕源时同时强制插件和数据刷新', async () => {
    const { player, api } = createDanmakuPlayer();
    const enabledRef = { current: true };
    markDanmakuContextAttached(player, loadContext, true);

    await reloadDanmaku(player, loadContext, enabledRef, {
      forcePluginReload: true,
      refreshData: true,
    });

    expect(api.load).toHaveBeenCalledTimes(1);
    expect(mockLoadDanmakuForEpisode).toHaveBeenCalledWith(
      loadContext,
      expect.any(Function),
      { forceRefresh: true, onError: expect.any(Function) },
    );
  });

  it('连续手动重载不复用旧任务并按顺序完成', async () => {
    const { player, api } = createDanmakuPlayer();
    const enabledRef = { current: true };
    let finishFirst: (() => void) | undefined;
    const firstLoadGate = new Promise<void>((resolve) => {
      finishFirst = resolve;
    });
    let loadCount = 0;
    api.load.mockImplementation(async () => {
      const loader = api.option.danmuku;
      if (typeof loader === 'function') {
        await (loader as () => Promise<unknown>)();
      }
      loadCount += 1;
      if (loadCount === 1) await firstLoadGate;
    });
    markDanmakuContextAttached(player, loadContext, true);

    const first = reloadDanmaku(player, loadContext, enabledRef, {
      forcePluginReload: true,
      refreshData: true,
    });
    await Promise.resolve();
    const second = reloadDanmaku(player, loadContext, enabledRef, {
      forcePluginReload: true,
      refreshData: true,
    });
    await Promise.resolve();

    expect(api.load).toHaveBeenCalledTimes(1);
    finishFirst?.();
    await Promise.all([first, second]);
    expect(api.load).toHaveBeenCalledTimes(2);
    expect(mockLoadDanmakuForEpisode).toHaveBeenCalledTimes(2);
  });

  it('快速重复开启时共用同一个插件加载任务', async () => {
    const { player, api } = createDanmakuPlayer();
    const enabledRef = { current: true };
    let finishLoad: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      finishLoad = resolve;
    });
    api.load.mockImplementationOnce(async () => {
      const loader = api.option.danmuku;
      if (typeof loader === 'function') {
        await (loader as () => Promise<unknown>)();
      }
      await gate;
    });
    markDanmakuContextAttached(player, loadContext, false);

    const first = ensureDanmakuLoaded(player, loadContext, enabledRef);
    const second = ensureDanmakuLoaded(player, loadContext, enabledRef);
    await Promise.resolve();

    expect(api.load).toHaveBeenCalledTimes(1);
    expect(mockLoadDanmakuForEpisode).toHaveBeenCalledTimes(1);
    finishLoad?.();
    await Promise.all([first, second]);
  });

  it('连续换集时串行加载且跳过尚未执行的过期上下文', async () => {
    const { player, api } = createDanmakuPlayer();
    const enabledRef = { current: true };
    const secondContext = { ...loadContext, episodeIndex: 1 };
    const latestContext = { ...loadContext, episodeIndex: 2 };
    markDanmakuContextAttached(player, loadContext, true);

    const secondLoad = reloadDanmaku(player, secondContext, enabledRef);
    const latestLoad = reloadDanmaku(player, latestContext, enabledRef);
    await Promise.all([secondLoad, latestLoad]);

    expect(api.load).toHaveBeenCalledTimes(1);
    expect(mockLoadDanmakuForEpisode).toHaveBeenCalledTimes(1);
    expect(mockLoadDanmakuForEpisode.mock.calls[0][0]).toEqual(latestContext);
  });
});
