import { showTimedArtNotice } from '@/lib/player-utils';

export type DanmakuLoadResult =
  | { status: 'loaded'; count: number }
  | { status: 'empty' }
  | { status: 'error' };

type NoticePlayer = NonNullable<Parameters<typeof showTimedArtNotice>[0]> & {
  template?: { $noticeInner?: HTMLElement };
};

interface DanmakuNoticeState {
  visible: boolean;
  isEnabled: () => boolean;
  loadId: symbol;
  pending: DanmakuLoadResult | null;
  displayedMessage: string | null;
  switchTasks: Set<Promise<unknown>>;
  latestSwitchTask: Promise<unknown> | null;
}

const noticeStates = new WeakMap<object, DanmakuNoticeState>();
const DANMAKU_NOTICE_DURATION_MS = 4000;

function getNoticeState(player: NoticePlayer): DanmakuNoticeState {
  let state = noticeStates.get(player);
  if (!state) {
    state = {
      visible: false,
      isEnabled: () => true,
      loadId: Symbol(),
      pending: null,
      displayedMessage: null,
      switchTasks: new Set(),
      latestSwitchTask: null,
    };
    noticeStates.set(player, state);
  }
  return state;
}

function hideDisplayedNotice(player: NoticePlayer, state: DanmakuNoticeState) {
  if (
    state.displayedMessage &&
    player.notice &&
    player.template?.$noticeInner?.textContent === state.displayedMessage
  ) {
    player.notice.show = '';
  }
  state.displayedMessage = null;
}

function flushNotice(player: NoticePlayer, state: DanmakuNoticeState) {
  if (!state.isEnabled()) state.pending = null;
  if (!state.visible || state.switchTasks.size > 0 || !state.pending) return;

  const result = state.pending;
  const message =
    result.status === 'loaded'
      ? `已装载${result.count}条弹幕`
      : result.status === 'empty'
        ? '本集暂无弹幕'
        : '弹幕加载失败，请尝试重新加载';
  state.pending = null;
  state.displayedMessage = message;
  showTimedArtNotice(player, message, DANMAKU_NOTICE_DURATION_MS);
}

export function clearDanmakuLoadNotice(player: NoticePlayer): void {
  const state = getNoticeState(player);
  state.pending = null;
  hideDisplayedNotice(player, state);
}

export function beginDanmakuLoadNotice(
  player: NoticePlayer,
  isEnabled: () => boolean = () => true,
): (result: DanmakuLoadResult) => void {
  const state = getNoticeState(player);
  const loadId = Symbol();
  state.loadId = loadId;
  state.isEnabled = isEnabled;
  clearDanmakuLoadNotice(player);

  return (result) => {
    if (state.loadId !== loadId) return;
    state.pending = result;
    flushNotice(player, state);
  };
}

export function setDanmakuLoadNoticeVisibility(
  player: NoticePlayer | null,
  visible: boolean,
): void {
  if (!player) return;
  const state = getNoticeState(player);
  state.visible = visible;
  if (!visible) {
    hideDisplayedNotice(player, state);
    return;
  }
  flushNotice(player, state);
}

export function waitForDanmakuPlayerSwitch(
  player: NoticePlayer,
  task: Promise<unknown>,
): void {
  const state = getNoticeState(player);
  state.switchTasks.add(task);
  state.latestSwitchTask = task;
  hideDisplayedNotice(player, state);
  void task.then(
    () => {
      state.switchTasks.delete(task);
      flushNotice(player, state);
    },
    () => {
      state.switchTasks.delete(task);
      if (state.latestSwitchTask === task) {
        clearDanmakuLoadNotice(player);
      } else {
        flushNotice(player, state);
      }
    },
  );
}
