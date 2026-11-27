import { Converter } from 'opencc-js/cn2t';

import {
  beginDanmakuLoadNotice,
  clearDanmakuLoadNotice,
  setDanmakuLoadNoticeVisibility,
  waitForDanmakuPlayerSwitch,
} from '@/features/play/lib/danmaku/load-notice';
import { type DisplayTextGlobals, toDisplayText } from '@/lib/display-text';
import { showTimedArtNotice } from '@/lib/player-utils';

jest.mock('@/lib/player-utils', () => ({
  showTimedArtNotice: jest.fn(),
}));

function createPlayer() {
  return {
    notice: { show: '' },
    template: { $noticeInner: document.createElement('div') },
  };
}

describe('danmaku load notices', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('waits for the overlay to disappear before starting the full notice duration', () => {
    const player = createPlayer();
    beginDanmakuLoadNotice(player)({ status: 'loaded', count: 100 });
    jest.advanceTimersByTime(30_000);
    expect(showTimedArtNotice).not.toHaveBeenCalled();

    setDanmakuLoadNoticeVisibility(player, true);
    expect(showTimedArtNotice).toHaveBeenCalledWith(
      player,
      '已装载100条弹幕',
      4000,
    );
    setDanmakuLoadNoticeVisibility(player, true);
    expect(showTimedArtNotice).toHaveBeenCalledTimes(1);
  });

  it.each([
    [{ status: 'empty' } as const, '暂未获取到弹幕，可稍后重新加载'],
    [{ status: 'error' } as const, '弹幕加载失败，请尝试重新加载'],
    [
      { status: 'rate-limited', retryAfterSeconds: 23 } as const,
      '弹幕服务请求频繁，请 23 秒后重试',
    ],
  ])(
    'shows the outcome when loading finishes after playback starts',
    (result, message) => {
      const player = createPlayer();
      setDanmakuLoadNoticeVisibility(player, true);
      beginDanmakuLoadNotice(player)(result);
      expect(showTimedArtNotice).toHaveBeenCalledWith(player, message, 4000);
    },
  );

  it('discards both queued and late results from the previous episode', () => {
    const player = createPlayer();
    const previousResult = beginDanmakuLoadNotice(player);
    previousResult({ status: 'loaded', count: 10 });
    const currentResult = beginDanmakuLoadNotice(player);
    setDanmakuLoadNoticeVisibility(player, true);
    previousResult({ status: 'error' });
    expect(showTimedArtNotice).not.toHaveBeenCalled();

    currentResult({ status: 'loaded', count: 20 });
    expect(showTimedArtNotice).toHaveBeenCalledTimes(1);
    expect(showTimedArtNotice).toHaveBeenCalledWith(
      player,
      '已装载20条弹幕',
      4000,
    );
  });

  it('does not show queued results after danmaku is turned off', () => {
    const player = createPlayer();
    const enabledRef = { current: true };
    beginDanmakuLoadNotice(
      player,
      () => enabledRef.current,
    )({ status: 'empty' });
    enabledRef.current = false;
    setDanmakuLoadNoticeVisibility(player, true);
    enabledRef.current = true;
    setDanmakuLoadNoticeVisibility(player, true);
    expect(showTimedArtNotice).not.toHaveBeenCalled();
  });

  it('hides its displayed message when another loading overlay appears', () => {
    const player = createPlayer();
    setDanmakuLoadNoticeVisibility(player, true);
    beginDanmakuLoadNotice(player)({ status: 'empty' });
    player.template.$noticeInner.textContent = '暂未获取到弹幕，可稍后重新加载';
    player.notice.show = '暂未获取到弹幕，可稍后重新加载';
    setDanmakuLoadNoticeVisibility(player, false);
    expect(player.notice.show).toBe('');
  });

  it('does not clear an unrelated player notice', () => {
    const player = createPlayer();
    setDanmakuLoadNoticeVisibility(player, true);
    beginDanmakuLoadNotice(player)({ status: 'empty' });
    player.template.$noticeInner.textContent = '已切换到新源';
    player.notice.show = '已切换到新源';
    clearDanmakuLoadNotice(player);
    expect(player.notice.show).toBe('已切换到新源');
  });

  it('waits for player switch cleanup even after the overlay disappears', async () => {
    const player = createPlayer();
    let finishSwitch: (() => void) | undefined;
    const switching = new Promise<void>((resolve) => {
      finishSwitch = resolve;
    });
    waitForDanmakuPlayerSwitch(player, switching);
    beginDanmakuLoadNotice(player)({ status: 'loaded', count: 10 });
    setDanmakuLoadNoticeVisibility(player, true);
    expect(showTimedArtNotice).not.toHaveBeenCalled();
    finishSwitch?.();
    await switching;
    expect(showTimedArtNotice).toHaveBeenCalledWith(
      player,
      '已装载10条弹幕',
      4000,
    );
  });

  it('does not flush when an earlier switch finishes during a newer switch', async () => {
    const player = createPlayer();
    let finishFirst: (() => void) | undefined;
    let finishSecond: (() => void) | undefined;
    const first = new Promise<void>((resolve) => {
      finishFirst = resolve;
    });
    const second = new Promise<void>((resolve) => {
      finishSecond = resolve;
    });
    waitForDanmakuPlayerSwitch(player, first);
    waitForDanmakuPlayerSwitch(player, second);
    beginDanmakuLoadNotice(player)({ status: 'empty' });
    setDanmakuLoadNoticeVisibility(player, true);
    finishFirst?.();
    await first;
    expect(showTimedArtNotice).not.toHaveBeenCalled();
    finishSecond?.();
    await second;
    expect(showTimedArtNotice).toHaveBeenCalledTimes(1);
  });

  it('waits for an older switch that resumes playback after the latest switch finishes', async () => {
    const player = createPlayer();
    let finishFirst: (() => void) | undefined;
    let finishSecond: (() => void) | undefined;
    const first = new Promise<void>((resolve) => {
      finishFirst = resolve;
    });
    const second = new Promise<void>((resolve) => {
      finishSecond = resolve;
    });
    waitForDanmakuPlayerSwitch(player, first);
    waitForDanmakuPlayerSwitch(player, second);
    beginDanmakuLoadNotice(player)({ status: 'loaded', count: 819 });
    setDanmakuLoadNoticeVisibility(player, true);
    finishSecond?.();
    await second;
    expect(showTimedArtNotice).not.toHaveBeenCalled();
    finishFirst?.();
    await first;
    expect(showTimedArtNotice).toHaveBeenCalledWith(
      player,
      '已装载819条弹幕',
      4000,
    );
  });
});

describe('繁体 notice 的显示文本比较', () => {
  const globals = globalThis as DisplayTextGlobals;
  beforeEach(() => {
    document.documentElement.lang = 'zh-TW';
    globals.__ICETV_DISPLAY_CONVERTER__ = Converter({ from: 'cn', to: 'twp' });
    (showTimedArtNotice as jest.Mock).mockImplementation((player, message) => {
      const displayed = toDisplayText(message);
      player.notice.show = displayed;
      player.template.$noticeInner.textContent = displayed;
    });
  });
  afterEach(() => {
    document.documentElement.lang = '';
    delete globals.__ICETV_DISPLAY_CONVERTER__;
    (showTimedArtNotice as jest.Mock).mockReset();
  });

  it('隐藏自己的已转换提示，保留其他来源覆盖的提示', () => {
    const player = createPlayer();
    setDanmakuLoadNoticeVisibility(player, true);
    beginDanmakuLoadNotice(player)({ status: 'loaded', count: 10 });
    expect(player.notice.show).toBe('已裝載10條彈幕');
    clearDanmakuLoadNotice(player);
    expect(player.notice.show).toBe('');

    beginDanmakuLoadNotice(player)({ status: 'empty' });
    player.notice.show = '其他提示';
    player.template.$noticeInner.textContent = '其他提示';
    clearDanmakuLoadNotice(player);
    expect(player.notice.show).toBe('其他提示');
  });
});
