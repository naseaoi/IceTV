import type Artplayer from 'artplayer';

import {
  createDanmakuPluginIfEnabled,
  ensureDanmakuLoaded,
  reloadDanmaku,
} from '@/features/play/lib/danmaku/attach';
import { setDanmakuLoadNoticeVisibility } from '@/features/play/lib/danmaku/load-notice';
import { createDanmakuPlugin } from '@/features/play/lib/danmaku/plugin';
import { loadDanmakuForEpisode } from '@/features/play/lib/danmaku/resolve';
import type { DanmakuItem } from '@/features/play/lib/danmaku/types';
import { showTimedArtNotice } from '@/lib/player-utils';

jest.mock('@/features/play/lib/danmaku/plugin', () => ({
  createDanmakuPlugin: jest.fn(),
}));
jest.mock('@/features/play/lib/danmaku/resolve', () => ({
  loadDanmakuForEpisode: jest.fn(),
}));
jest.mock('@/lib/runtime-config', () => ({
  getRuntimeConfig: () => ({ ENABLE_DANMAKU: true }),
}));
jest.mock('@/lib/player-utils', () => ({
  showTimedArtNotice: jest.fn(),
}));

const context = {
  source: 'source-a',
  videoId: 'video-a',
  episodeIndex: 0,
  searchTitle: '测试影片',
  searchYear: '2026',
};
const items: DanmakuItem[] = [
  { text: 'test', time: 1, mode: 0, color: '#ffffff' },
];
const mockLoad = loadDanmakuForEpisode as jest.MockedFunction<
  typeof loadDanmakuForEpisode
>;

async function createPlayer(enabledRef = { current: true }) {
  const handlers = new Map<string, (payload?: unknown) => unknown>();
  const option = { danmuku: async () => [] as DanmakuItem[] };
  const api = {
    option,
    reset: jest.fn(),
    load: jest.fn(async () => {
      const loaded = await option.danmuku();
      handlers.get('artplayerPluginDanmuku:loaded')?.(loaded);
    }),
  };
  const player = {
    notice: { show: '' },
    plugins: { artplayerPluginDanmuku: api },
    on: (event: string, handler: (payload?: unknown) => unknown) => {
      handlers.set(event, handler);
    },
  } as unknown as Artplayer;
  let initialTask: Promise<void> | undefined;
  (createDanmakuPlugin as jest.Mock).mockImplementation(
    async ({ loadItems }) =>
      () => {
        option.danmuku = loadItems;
        initialTask = api.load();
        return api;
      },
  );
  const plugin = await createDanmakuPluginIfEnabled(context, enabledRef);
  plugin?.(player);
  return { player, api, initialTask, handlers, enabledRef };
}

describe('attached danmaku result notices', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    mockLoad.mockResolvedValue(items);
  });

  it('defers the real plugin queue count until the playback overlay is removed', async () => {
    const { player, initialTask } = await createPlayer();
    await initialTask;
    expect(showTimedArtNotice).not.toHaveBeenCalled();
    setDanmakuLoadNoticeVisibility(player, true);
    expect(showTimedArtNotice).toHaveBeenCalledWith(
      player,
      '已装载1条弹幕',
      4000,
    );
  });

  it('reports resolver failure rather than the empty queue emitted by the plugin', async () => {
    mockLoad.mockImplementationOnce(async (_context, _isEnabled, options) => {
      options?.onError?.();
      return [];
    });
    const { player, initialTask, enabledRef, api } = await createPlayer();
    await initialTask;
    setDanmakuLoadNoticeVisibility(player, true);
    expect(showTimedArtNotice).toHaveBeenCalledWith(
      player,
      '弹幕加载失败，请尝试重新加载',
      4000,
    );

    await ensureDanmakuLoaded(player, context, enabledRef);
    expect(api.load).toHaveBeenCalledTimes(2);
    expect(showTimedArtNotice).toHaveBeenLastCalledWith(
      player,
      '已装载1条弹幕',
      4000,
    );
  });

  it('waits for initial plugin loading before reloading and suppresses the old episode result', async () => {
    let finishInitial: ((value: DanmakuItem[]) => void) | undefined;
    mockLoad.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishInitial = resolve;
        }),
    );
    const { player, initialTask, enabledRef, api } = await createPlayer();
    const nextLoad = reloadDanmaku(
      player,
      { ...context, episodeIndex: 1 },
      enabledRef,
    );
    setDanmakuLoadNoticeVisibility(player, true);
    await Promise.resolve();
    expect(api.load).toHaveBeenCalledTimes(1);
    finishInitial?.(items);
    await initialTask;
    await nextLoad;
    expect(api.load).toHaveBeenCalledTimes(2);
    expect(showTimedArtNotice).toHaveBeenCalledTimes(1);
    expect(mockLoad.mock.calls[1][0].episodeIndex).toBe(1);
  });

  it('does not report disabled loading as an empty success', async () => {
    mockLoad.mockResolvedValue([]);
    const { player, initialTask } = await createPlayer({ current: false });
    await initialTask;
    setDanmakuLoadNoticeVisibility(player, true);
    expect(showTimedArtNotice).not.toHaveBeenCalled();
  });

  it('reports plugin reload errors once and allows a retry', async () => {
    const { player, initialTask, api, handlers, enabledRef } =
      await createPlayer();
    await initialTask;
    setDanmakuLoadNoticeVisibility(player, true);
    jest.mocked(showTimedArtNotice).mockClear();
    const warning = jest.spyOn(console, 'warn').mockImplementation(() => {});
    api.load.mockImplementationOnce(async () => {
      handlers.get('artplayerPluginDanmuku:error')?.(new Error('plugin error'));
      throw new Error('plugin error');
    });
    await reloadDanmaku(player, context, enabledRef, {
      forcePluginReload: true,
    });
    expect(showTimedArtNotice).toHaveBeenCalledTimes(1);
    expect(showTimedArtNotice).toHaveBeenCalledWith(
      player,
      '弹幕加载失败，请尝试重新加载',
      4000,
    );
    await ensureDanmakuLoaded(player, context, enabledRef);
    expect(showTimedArtNotice).toHaveBeenLastCalledWith(
      player,
      '已装载1条弹幕',
      4000,
    );
    warning.mockRestore();
  });

  it('ignores late results after player destruction', async () => {
    let finishInitial: ((value: DanmakuItem[]) => void) | undefined;
    mockLoad.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishInitial = resolve;
        }),
    );
    const { player, initialTask, handlers } = await createPlayer();
    setDanmakuLoadNoticeVisibility(player, true);
    handlers.get('destroy')?.();
    finishInitial?.(items);
    await initialTask;
    expect(showTimedArtNotice).not.toHaveBeenCalled();
  });
});
