import {
  beginDanmakuLoadNotice,
  clearDanmakuLoadNotice,
  setDanmakuLoadNoticeVisibility,
  waitForDanmakuPlayerSwitch,
} from '@/features/play/lib/danmaku/load-notice';
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
    [{ status: 'empty' } as const, '本集暂无弹幕'],
    [{ status: 'error' } as const, '弹幕加载失败，请尝试重新加载'],
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
    player.template.$noticeInner.textContent = '本集暂无弹幕';
    player.notice.show = '本集暂无弹幕';
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
