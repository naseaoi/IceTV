import type Artplayer from 'artplayer';
import { MutableRefObject, useEffect } from 'react';

/**
 * 通用播放器键盘快捷键 hook
 * 基础功能（音量、播放/暂停、全屏）适用于 VOD + Live
 * 扩展功能（快进快退、上/下集）通过 episodeHandlers 注入
 */

interface EpisodeHandlers {
  detailRef: MutableRefObject<{ episodes: unknown[] } | null>;
  currentEpisodeIndexRef: MutableRefObject<number>;
  handlePreviousEpisode: () => void;
  handleNextEpisode: () => void;
}

interface UsePlayerKeyboardParams {
  artPlayerRef: MutableRefObject<Artplayer | null>;
  /** VOD 模式传入集数控制，Live 模式不传 */
  episodeHandlers?: EpisodeHandlers;
}

export function usePlayerKeyboard({
  artPlayerRef,
  episodeHandlers,
}: UsePlayerKeyboardParams) {
  useEffect(() => {
    const handleKeyboardShortcuts = (e: KeyboardEvent) => {
      // 忽略输入框中的按键事件
      if (
        (e.target as HTMLElement).tagName === 'INPUT' ||
        (e.target as HTMLElement).tagName === 'TEXTAREA'
      )
        return;

      // --- VOD 专用：Alt+方向键切集、方向键快进快退 ---
      if (episodeHandlers) {
        // Alt + 左箭头 = 上一集
        if (e.altKey && e.key === 'ArrowLeft') {
          if (
            episodeHandlers.detailRef.current &&
            episodeHandlers.currentEpisodeIndexRef.current > 0
          ) {
            episodeHandlers.handlePreviousEpisode();
            e.preventDefault();
          }
          return;
        }

        // Alt + 右箭头 = 下一集
        if (e.altKey && e.key === 'ArrowRight') {
          const d = episodeHandlers.detailRef.current;
          const idx = episodeHandlers.currentEpisodeIndexRef.current;
          if (d && idx < d.episodes.length - 1) {
            episodeHandlers.handleNextEpisode();
            e.preventDefault();
          }
          return;
        }

        // 左箭头 = 快退
        if (!e.altKey && e.key === 'ArrowLeft') {
          if (artPlayerRef.current && artPlayerRef.current.currentTime > 5) {
            artPlayerRef.current.currentTime -= 10;
            e.preventDefault();
          }
          return;
        }

        // 右箭头 = 快进
        if (!e.altKey && e.key === 'ArrowRight') {
          if (
            artPlayerRef.current &&
            artPlayerRef.current.currentTime < artPlayerRef.current.duration - 5
          ) {
            artPlayerRef.current.currentTime += 10;
            e.preventDefault();
          }
          return;
        }
      }

      // --- 通用快捷键 ---

      // 上箭头 = 音量+
      if (e.key === 'ArrowUp') {
        if (artPlayerRef.current && artPlayerRef.current.volume < 1) {
          artPlayerRef.current.volume =
            Math.round((artPlayerRef.current.volume + 0.1) * 10) / 10;
          artPlayerRef.current.notice.show = `音量: ${Math.round(
            artPlayerRef.current.volume * 100,
          )}`;
          e.preventDefault();
        }
      }

      // 下箭头 = 音量-
      if (e.key === 'ArrowDown') {
        if (artPlayerRef.current && artPlayerRef.current.volume > 0) {
          artPlayerRef.current.volume =
            Math.round((artPlayerRef.current.volume - 0.1) * 10) / 10;
          artPlayerRef.current.notice.show = `音量: ${Math.round(
            artPlayerRef.current.volume * 100,
          )}`;
          e.preventDefault();
        }
      }

      // 空格 = 播放/暂停
      if (e.key === ' ') {
        if (artPlayerRef.current) {
          artPlayerRef.current.toggle();
          e.preventDefault();
        }
      }

      // f 键 = 切换全屏
      if (e.key === 'f' || e.key === 'F') {
        if (artPlayerRef.current) {
          artPlayerRef.current.fullscreen = !artPlayerRef.current.fullscreen;
          e.preventDefault();
        }
      }
    };

    document.addEventListener('keydown', handleKeyboardShortcuts);
    return () => {
      document.removeEventListener('keydown', handleKeyboardShortcuts);
    };
  }, [artPlayerRef, episodeHandlers]);
}
