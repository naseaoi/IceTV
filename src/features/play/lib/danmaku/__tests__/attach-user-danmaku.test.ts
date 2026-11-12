import type Artplayer from 'artplayer';

import {
  createDanmakuPluginIfEnabled,
  reloadDanmaku,
} from '@/features/play/lib/danmaku/attach';
import {
  type DanmakuEmitPayload,
  createDanmakuPlugin,
} from '@/features/play/lib/danmaku/plugin';
import { loadDanmakuForEpisode } from '@/features/play/lib/danmaku/resolve';
import type { DanmakuItem } from '@/features/play/lib/danmaku/types';
import { sendUserDanmaku } from '@/features/play/lib/danmaku/user-client';
import { DisplayableError } from '@/lib/user-facing-error';

jest.mock('@/features/play/lib/danmaku/plugin', () => ({
  createDanmakuPlugin: jest.fn(),
  loadDanmakuPluginModule: jest.fn(),
}));
jest.mock('@/features/play/lib/danmaku/resolve', () => ({
  loadDanmakuForEpisode: jest.fn(),
}));
jest.mock('@/features/play/lib/danmaku/user-client', () => ({
  sendUserDanmaku: jest.fn(),
}));
jest.mock('@/lib/runtime-config', () => ({
  getRuntimeConfig: () => ({ ENABLE_DANMAKU: true, ENABLE_USER_DANMAKU: true }),
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
const mockLoad = loadDanmakuForEpisode as jest.MockedFunction<
  typeof loadDanmakuForEpisode
>;
const mockSend = sendUserDanmaku as jest.MockedFunction<typeof sendUserDanmaku>;

async function createPlayer() {
  const enabledRef = { current: true };
  const option = { danmuku: async () => [] as DanmakuItem[] };
  const api = {
    option,
    reset: jest.fn(),
    load: jest.fn(async () => {
      await option.danmuku();
    }),
  };
  const player = {
    notice: { show: '' },
    plugins: { artplayerPluginDanmuku: api },
    on: jest.fn(),
  } as unknown as Artplayer & { notice: { show: string } };
  let beforeEmit: ((danmu: DanmakuEmitPayload) => Promise<boolean>) | undefined;
  let initialTask: Promise<void> | undefined;
  (createDanmakuPlugin as jest.Mock).mockImplementation(async (options) => {
    beforeEmit = options.beforeEmit;
    return () => {
      option.danmuku = options.loadItems;
      initialTask = api.load();
      return api;
    };
  });
  const plugin = await createDanmakuPluginIfEnabled(context, enabledRef);
  plugin?.(player);
  return {
    player,
    enabledRef,
    initialTask,
    emit: (danmu: DanmakuEmitPayload) => {
      if (!beforeEmit) throw new Error('beforeEmit missing');
      return beforeEmit(danmu);
    },
  };
}

describe('user danmaku emitter', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    mockSend.mockResolvedValue({
      id: '1',
      time: 0,
      text: 'x',
      mode: 0,
      color: '#ffffff',
      mine: true,
    });
  });

  it('converts player time back to the danmaku timeline before sending', async () => {
    mockLoad.mockImplementation(async (_context, _enabled, options) => {
      options?.onUserTarget?.({ key: 'dandan:42', offset: 3 });
      return [];
    });
    const { emit, initialTask } = await createPlayer();
    await initialTask;

    await expect(
      emit({ text: '  你好\u200b  ', time: 10, mode: 1, color: '#FF0000' }),
    ).resolves.toBe(true);
    expect(mockSend).toHaveBeenCalledWith({
      key: 'dandan:42',
      time: 7,
      text: '你好',
      mode: 1,
      color: '#ff0000',
    });
  });

  it('refuses to send before the episode target is known', async () => {
    mockLoad.mockImplementation(() => new Promise(() => {}));
    const { emit, player } = await createPlayer();

    await expect(emit({ text: '你好', time: 1 })).resolves.toBe(false);
    expect(mockSend).not.toHaveBeenCalled();
    expect(player.notice.show).toBe('弹幕加载中，请稍后再发');
  });

  it('refuses to send while danmaku is hidden', async () => {
    mockLoad.mockImplementation(async (_context, _enabled, options) => {
      options?.onUserTarget?.({ key: 'dandan:42', offset: 0 });
      return [];
    });
    const { emit, player, enabledRef, initialTask } = await createPlayer();
    await initialTask;
    enabledRef.current = false;

    await expect(emit({ text: '你好', time: 1 })).resolves.toBe(false);
    expect(mockSend).not.toHaveBeenCalled();
    expect(player.notice.show).toBe('请先打开弹幕');
  });

  it('shows the server message and does not echo on failure', async () => {
    mockLoad.mockImplementation(async (_context, _enabled, options) => {
      options?.onUserTarget?.({ key: 'dandan:42', offset: 0 });
      return [];
    });
    mockSend.mockRejectedValueOnce(
      new DisplayableError('发送太频繁，请稍后再试'),
    );
    const { emit, player, initialTask } = await createPlayer();
    await initialTask;

    await expect(emit({ text: '你好', time: 1 })).resolves.toBe(false);
    expect(player.notice.show).toBe('发送太频繁，请稍后再试');
  });

  it('saves without echo when the episode changes during the request', async () => {
    mockLoad.mockImplementation(async (_context, _enabled, options) => {
      options?.onUserTarget?.({ key: 'dandan:42', offset: 0 });
      return [];
    });
    let finishSend: (() => void) | undefined;
    mockSend.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishSend = () =>
            resolve({
              id: '1',
              time: 1,
              text: '你好',
              mode: 0,
              color: '#ffffff',
              mine: true,
            });
        }),
    );
    const { emit, player, enabledRef, initialTask } = await createPlayer();
    await initialTask;

    const pending = emit({ text: '你好', time: 1 });
    mockLoad.mockImplementation(() => new Promise(() => {}));
    void reloadDanmaku(player, { ...context, episodeIndex: 1 }, enabledRef);
    await Promise.resolve();
    finishSend?.();

    await expect(pending).resolves.toBe(false);
    expect(mockSend).toHaveBeenCalledTimes(1);
  });
});
