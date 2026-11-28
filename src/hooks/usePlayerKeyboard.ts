import type Artplayer from 'artplayer';
import { MutableRefObject, useEffect, useRef } from 'react';

import { toDisplayText } from '@/lib/display-text';
import {
  enterPlayerFastForward,
  exitPlayerFastForward,
  getPlayerFastForwardTime,
  subscribePlayerFastForwardReset,
} from '@/lib/player-runtime';
import {
  type PlayerShortcutAction,
  type PlayerShortcutMap,
  type PlayerShortcutMode,
  type ShortcutBinding,
  arePlayerShortcutsSuspended,
  FRAME_STEP_SECONDS,
  isPlayerShortcutActionEnabled,
  normalizeShortcutKey,
  PLAYER_SHORTCUTS_CHANGED_EVENT,
  PLAYER_SHORTCUTS_SUSPENDED_CHANGED_EVENT,
  RATE_MAX,
  RATE_MIN,
  RATE_STEP,
  readPlayerShortcuts,
  resolveShortcutAction,
  SEEK_STEP_LONG_SECONDS,
  SEEK_STEP_SECONDS,
  VOLUME_STEP,
} from '@/lib/player-shortcuts';

interface EpisodeHandlers {
  detailRef: MutableRefObject<{ episodes: unknown[] } | null>;
  currentEpisodeIndexRef: MutableRefObject<number>;
  handlePreviousEpisode: () => void;
  handleNextEpisode: () => void;
}

interface UsePlayerKeyboardParams {
  artPlayerRef: MutableRefObject<Artplayer | null>;
  episodeHandlers?: EpisodeHandlers;
  channelHandlers?: { previous: () => void; next: () => void };
  mode?: PlayerShortcutMode;
}

const FRAME_STEP_LOADING_GUARD_MS = 600;
const FAST_FORWARD_PLAY_ICON =
  '<svg viewBox="0 0 12 12" width="10" height="10" fill="currentColor" aria-hidden="true"><path d="M2.5 1.5L10.5 6L2.5 10.5Z"/></svg>';

const ACTIVATION_KEYS = new Set(['Enter', ' ']);
const ACTIVATABLE_CONTROL_SELECTOR =
  'button, a[href], summary, [role="button"], [role="link"], [role="menuitem"], [role="option"], [role="tab"], [role="checkbox"], [role="radio"], [role="switch"]';

function isBindingReleased(
  event: KeyboardEvent,
  binding: ShortcutBinding,
  code: string,
): boolean {
  if (code && event.code === code) {
    return true;
  }
  if (normalizeShortcutKey(event.key) === normalizeShortcutKey(binding.key)) {
    return true;
  }
  if (binding.shiftKey && event.key === 'Shift') return true;
  if (binding.altKey && event.key === 'Alt') return true;
  if (binding.ctrlKey && event.key === 'Control') return true;
  return false;
}

function mountFastForwardNotice(
  player: Artplayer,
  fastForwardRate: number,
): HTMLDivElement | null {
  const container = (player.template as unknown as { $player?: HTMLElement })
    ?.$player;
  if (!container) return null;

  const notice = document.createElement('div');
  notice.className = 'ice-fast-forward-notice';
  const inner = document.createElement('div');
  inner.className = 'ice-fast-forward-notice-inner';
  inner.innerHTML = FAST_FORWARD_PLAY_ICON;
  const label = document.createElement('span');
  label.textContent = toDisplayText(`${fastForwardRate}倍速中`);
  inner.appendChild(label);
  notice.appendChild(inner);
  container.appendChild(notice);
  return notice;
}

// 只让出键盘聚焦（:focus-visible）的控件：鼠标点过的按钮仍保持焦点，
// 若一律让出，点完选集再按空格会重复点击按钮而不是暂停
function isKeyboardActivatingControl(
  event: KeyboardEvent,
  target: HTMLElement,
): boolean {
  if (!ACTIVATION_KEYS.has(event.key) || !(target instanceof Element)) {
    return false;
  }
  const control = target.closest(ACTIVATABLE_CONTROL_SELECTOR);
  return control !== null && control.matches(':focus-visible');
}

function clampRate(rate: number): number {
  const rounded = Math.round(rate * 10) / 10;
  return Math.min(RATE_MAX, Math.max(RATE_MIN, rounded));
}

export function usePlayerKeyboard({
  artPlayerRef,
  episodeHandlers,
  channelHandlers,
  mode = 'vod',
}: UsePlayerKeyboardParams) {
  const episodeHandlersRef = useRef(episodeHandlers);
  episodeHandlersRef.current = episodeHandlers;
  const channelHandlersRef = useRef(channelHandlers);
  channelHandlersRef.current = channelHandlers;

  useEffect(() => {
    interface SeekForwardHoldState {
      player: Artplayer;
      binding: ShortcutBinding;
      code: string;
      timer: number | null;
      active: boolean;
      fastForwardRate: number;
      previousPlaybackRate: number;
      noticeElement: HTMLDivElement | null;
      cleanupListeners: () => void;
    }

    let shortcuts: PlayerShortcutMap = readPlayerShortcuts();
    let frameStepLoadingTimer: number | null = null;
    let frameStepLoadingGuard: {
      player: Artplayer;
      handler: (visible: boolean) => void;
    } | null = null;
    let seekForwardHold: SeekForwardHoldState | null = null;

    const releaseLoadingSpinnerGuard = () => {
      if (frameStepLoadingTimer !== null) {
        window.clearTimeout(frameStepLoadingTimer);
        frameStepLoadingTimer = null;
      }
      if (!frameStepLoadingGuard) return;
      const { player, handler } = frameStepLoadingGuard;
      frameStepLoadingGuard = null;
      (
        player as unknown as {
          off: (name: string, fn: (visible: boolean) => void) => void;
        }
      ).off('loading', handler);
    };

    const cancelSeekForwardHold = (
      options: { restoreRate?: boolean; skipExit?: boolean } = {},
    ) => {
      const hold = seekForwardHold;
      if (!hold) return;
      seekForwardHold = null;

      if (hold.timer !== null) {
        window.clearTimeout(hold.timer);
        hold.timer = null;
      }
      hold.cleanupListeners();
      hold.noticeElement?.remove();
      hold.noticeElement = null;

      if (hold.active && !options.skipExit) {
        exitPlayerFastForward(hold.player, hold.previousPlaybackRate, {
          silent: true,
          restoreRate: options.restoreRate,
        });
      }
    };

    const handleCancelHoldEvent = () => {
      cancelSeekForwardHold();
    };

    const syncShortcuts = () => {
      shortcuts = readPlayerShortcuts();
      cancelSeekForwardHold();
    };
    const handleShortcutsSuspended = () => {
      if (arePlayerShortcutsSuspended()) {
        cancelSeekForwardHold();
      }
    };
    const handleVisibilityChange = () => {
      if (document.hidden || document.visibilityState === 'hidden') {
        cancelSeekForwardHold();
      }
    };

    window.addEventListener(PLAYER_SHORTCUTS_CHANGED_EVENT, syncShortcuts);
    window.addEventListener(
      PLAYER_SHORTCUTS_SUSPENDED_CHANGED_EVENT,
      handleShortcutsSuspended,
    );
    window.addEventListener('blur', handleCancelHoldEvent);
    window.addEventListener('contextmenu', handleCancelHoldEvent);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    const seekBy = (seconds: number) => {
      const player = artPlayerRef.current;
      if (!player) return;
      const duration = player.duration || 0;
      const next = Math.min(
        Math.max(0, player.currentTime + seconds),
        duration > 0 ? duration : player.currentTime + seconds,
      );
      player.currentTime = next;
      const arrow = seconds > 0 ? '快进' : '快退';
      player.notice.show = toDisplayText(`${arrow} ${Math.abs(seconds)} 秒`);
    };

    const changeVolume = (delta: number) => {
      const player = artPlayerRef.current;
      if (!player) return;
      const next = Math.round((player.volume + delta) * 10) / 10;
      player.volume = Math.min(1, Math.max(0, next));
      player.notice.show = toDisplayText(
        `音量: ${Math.round(player.volume * 100)}`,
      );
    };

    const changeRate = (delta: number) => {
      const player = artPlayerRef.current;
      if (!player) return;
      const next = clampRate((player.playbackRate as number) + delta);
      player.playbackRate = next;
      player.notice.show = toDisplayText(`倍速: ${next.toFixed(1)}x`);
    };

    const resetRate = () => {
      const player = artPlayerRef.current;
      if (!player) return;
      player.playbackRate = 1;
      player.notice.show = toDisplayText('倍速: 1.0x');
    };

    const hidePauseStateIcon = (player: Artplayer) => {
      const stateEl = (player.template as unknown as { $state?: HTMLElement })
        .$state;
      if (!stateEl || stateEl.style.display === 'none') return;
      stateEl.style.display = 'none';
      player.once('play', () => {
        stateEl.style.display = '';
      });
    };

    const suppressLoadingSpinner = (player: Artplayer) => {
      if (frameStepLoadingGuard && frameStepLoadingGuard.player !== player) {
        releaseLoadingSpinnerGuard();
      }
      if (frameStepLoadingTimer !== null) {
        window.clearTimeout(frameStepLoadingTimer);
        frameStepLoadingTimer = null;
      }
      if (!frameStepLoadingGuard) {
        frameStepLoadingGuard = {
          player,
          handler: (visible: boolean) => {
            if (visible) {
              player.loading.show = false;
            }
          },
        };
        player.on('loading', frameStepLoadingGuard.handler);
      }
      player.loading.show = false;
      frameStepLoadingTimer = window.setTimeout(
        releaseLoadingSpinnerGuard,
        FRAME_STEP_LOADING_GUARD_MS,
      );
    };

    const stepFrame = (direction: 1 | -1) => {
      const player = artPlayerRef.current;
      if (!player) return;
      if (player.playing) {
        player.pause();
      }
      hidePauseStateIcon(player);
      suppressLoadingSpinner(player);
      player.notice.show = '';
      const duration = player.duration || 0;
      const next = player.currentTime + direction * FRAME_STEP_SECONDS;
      player.currentTime = Math.min(
        Math.max(0, next),
        duration > 0 ? duration : next,
      );
    };

    const toggleMute = () => {
      const player = artPlayerRef.current;
      if (!player) return;
      player.muted = !player.muted;
      player.notice.show = toDisplayText(
        player.muted ? '已静音' : `音量: ${Math.round(player.volume * 100)}`,
      );
    };

    const toggleFullscreen = () => {
      const player = artPlayerRef.current;
      if (!player) return;
      player.fullscreen = !player.fullscreen;
    };

    const switchEpisode = (direction: 1 | -1): boolean => {
      const currentEpisodeHandlers = episodeHandlersRef.current;
      if (!currentEpisodeHandlers) return false;
      const detail = currentEpisodeHandlers.detailRef.current;
      const index = currentEpisodeHandlers.currentEpisodeIndexRef.current;
      if (direction < 0) {
        if (detail && index > 0) {
          cancelSeekForwardHold();
          currentEpisodeHandlers.handlePreviousEpisode();
          return true;
        }
        return false;
      }
      if (detail && index < detail.episodes.length - 1) {
        cancelSeekForwardHold();
        currentEpisodeHandlers.handleNextEpisode();
        return true;
      }
      return false;
    };

    const actionHandlers: Record<PlayerShortcutAction, () => void> = {
      playPause: () => artPlayerRef.current?.toggle(),
      seekBackward: () => seekBy(-SEEK_STEP_SECONDS),
      seekForward: () => seekBy(SEEK_STEP_SECONDS),
      seekBackwardLong: () => seekBy(-SEEK_STEP_LONG_SECONDS),
      seekForwardLong: () => seekBy(SEEK_STEP_LONG_SECONDS),
      volumeUp: () => changeVolume(VOLUME_STEP),
      volumeDown: () => changeVolume(-VOLUME_STEP),
      toggleMute,
      fullscreen: toggleFullscreen,
      resetRate,
      decreaseRate: () => changeRate(-RATE_STEP),
      increaseRate: () => changeRate(RATE_STEP),
      frameBackward: () => stepFrame(-1),
      frameForward: () => stepFrame(1),
      prevEpisode: () => switchEpisode(-1),
      nextEpisode: () => switchEpisode(1),
      prevChannel: () => channelHandlersRef.current?.previous(),
      nextChannel: () => channelHandlersRef.current?.next(),
    };

    const isEpisodeAction = (action: PlayerShortcutAction) =>
      action === 'prevEpisode' || action === 'nextEpisode';

    const startSeekForwardHold = (player: Artplayer, code: string) => {
      if (seekForwardHold) {
        if (seekForwardHold.player === player) {
          return;
        }
        cancelSeekForwardHold();
      }

      const binding: ShortcutBinding = { ...shortcuts.seekForward };
      const playerEvents = player as unknown as {
        on?: (name: string, fn: () => void) => void;
        off?: (name: string, fn: () => void) => void;
      };
      const handlePlayerStop = () => {
        if (seekForwardHold === hold) {
          cancelSeekForwardHold();
        }
      };
      const handleExternalReset = () => {
        if (seekForwardHold === hold) {
          cancelSeekForwardHold({ skipExit: true });
        }
      };
      const handlePause = () => {
        if (seekForwardHold === hold && hold.active) {
          cancelSeekForwardHold();
        }
      };
      const handleRateChange = () => {
        if (seekForwardHold !== hold || !hold.active) return;
        const currentRate = Number(hold.player.playbackRate);
        if (
          Number.isFinite(currentRate) &&
          Math.abs(currentRate - hold.fastForwardRate) > 0.01
        ) {
          cancelSeekForwardHold({ restoreRate: false });
        }
      };

      const unsubscribeReset = subscribePlayerFastForwardReset(
        player,
        handleExternalReset,
      );
      playerEvents.on?.('destroy', handlePlayerStop);
      playerEvents.on?.('video:ended', handlePlayerStop);
      playerEvents.on?.('video:pause', handlePause);
      playerEvents.on?.('video:ratechange', handleRateChange);

      const hold: SeekForwardHoldState = {
        player,
        binding,
        code,
        timer: null,
        active: false,
        fastForwardRate: 3,
        previousPlaybackRate: 1,
        noticeElement: null,
        cleanupListeners: () => {
          unsubscribeReset();
          playerEvents.off?.('destroy', handlePlayerStop);
          playerEvents.off?.('video:ended', handlePlayerStop);
          playerEvents.off?.('video:pause', handlePause);
          playerEvents.off?.('video:ratechange', handleRateChange);
        },
      };
      seekForwardHold = hold;

      hold.timer = window.setTimeout(() => {
        if (seekForwardHold !== hold) return;
        hold.timer = null;

        if (
          artPlayerRef.current !== hold.player ||
          (hold.player as unknown as { isDestroy?: boolean }).isDestroy ||
          arePlayerShortcutsSuspended() ||
          document.hidden
        ) {
          cancelSeekForwardHold();
          return;
        }

        if (!hold.player.playing) {
          return;
        }

        const handle = enterPlayerFastForward(hold.player, { silent: true });
        if (!handle) {
          return;
        }
        hold.active = true;
        hold.previousPlaybackRate = handle.previousPlaybackRate;
        hold.fastForwardRate = handle.fastForwardRate;
        hold.noticeElement = mountFastForwardNotice(
          hold.player,
          handle.fastForwardRate,
        );
      }, getPlayerFastForwardTime(player));
    };

    const handleKeyboardShortcuts = (e: KeyboardEvent) => {
      if (seekForwardHold && artPlayerRef.current !== seekForwardHold.player) {
        cancelSeekForwardHold();
      }

      const target = e.target as HTMLElement;
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable ||
        isKeyboardActivatingControl(e, target)
      ) {
        return;
      }

      if (arePlayerShortcutsSuspended()) {
        cancelSeekForwardHold();
        return;
      }

      const action = resolveShortcutAction(e, shortcuts);
      if (!action) return;

      if (!isPlayerShortcutActionEnabled(mode, action)) {
        return;
      }

      if (isEpisodeAction(action) && !episodeHandlersRef.current) {
        return;
      }

      if (action === 'prevChannel' || action === 'nextChannel') {
        if (!channelHandlersRef.current) return;
      } else if (!artPlayerRef.current) return;

      e.preventDefault();

      if (action === 'seekForward') {
        if (e.repeat) return;
        startSeekForwardHold(artPlayerRef.current!, e.code || '');
        return;
      }

      if (
        seekForwardHold?.active &&
        (action === 'resetRate' ||
          action === 'decreaseRate' ||
          action === 'increaseRate')
      ) {
        cancelSeekForwardHold();
      }

      actionHandlers[action]();
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      const hold = seekForwardHold;
      if (!hold) return;
      if (e.key === 'Meta') {
        cancelSeekForwardHold();
        return;
      }
      if (!isBindingReleased(e, hold.binding, hold.code)) return;

      const wasActive = hold.active;
      const samePlayer =
        artPlayerRef.current === hold.player &&
        !(hold.player as unknown as { isDestroy?: boolean }).isDestroy;
      cancelSeekForwardHold();

      if (!wasActive && samePlayer && !arePlayerShortcutsSuspended()) {
        seekBy(SEEK_STEP_SECONDS);
      }
    };

    document.addEventListener('keydown', handleKeyboardShortcuts);
    document.addEventListener('keyup', handleKeyUp);
    return () => {
      document.removeEventListener('keydown', handleKeyboardShortcuts);
      document.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener(PLAYER_SHORTCUTS_CHANGED_EVENT, syncShortcuts);
      window.removeEventListener(
        PLAYER_SHORTCUTS_SUSPENDED_CHANGED_EVENT,
        handleShortcutsSuspended,
      );
      window.removeEventListener('blur', handleCancelHoldEvent);
      window.removeEventListener('contextmenu', handleCancelHoldEvent);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      cancelSeekForwardHold();
      releaseLoadingSpinnerGuard();
    };
  }, [artPlayerRef, mode]);
}
