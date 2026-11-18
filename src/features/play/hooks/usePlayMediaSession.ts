import type Artplayer from 'artplayer';
import { MutableRefObject, useEffect, useRef } from 'react';

import { useSite } from '@/components/SiteProvider';
import { processImageUrl } from '@/lib/utils';

const SEEK_STEP_SECONDS = 10;
const MEDIA_SESSION_SYNC_EVENTS = [
  'play',
  'pause',
  'ended',
  'seeked',
  'ratechange',
  'durationchange',
  'loadedmetadata',
] as const;

type MediaSessionAction =
  | 'play'
  | 'pause'
  | 'seekbackward'
  | 'seekforward'
  | 'seekto'
  | 'previoustrack'
  | 'nexttrack';

export function buildPlayDocumentTitle({
  siteName,
  videoTitle,
  episodeLabel,
}: {
  siteName: string;
  videoTitle: string;
  episodeLabel: string | null;
}) {
  const title = videoTitle.trim();
  if (!title) return siteName;
  return [title, episodeLabel, siteName].filter(Boolean).join(' - ');
}

function setActionHandler(
  action: MediaSessionAction,
  handler: MediaSessionActionHandler | null,
) {
  try {
    navigator.mediaSession.setActionHandler(action, handler);
  } catch {
    // 部分浏览器不支持个别动作，抛错时跳过即可
  }
}

/**
 * 播放页标题与系统媒体控件（锁屏、通知栏、耳机按键）。
 * 媒体事件不冒泡，在 document 捕获阶段监听，播放器重建、换源后无需重新绑定。
 */
export function usePlayMediaSession({
  artPlayerRef,
  videoTitle,
  episodeLabel,
  videoCover,
  hasPreviousEpisode,
  hasNextEpisode,
  onPreviousEpisode,
  onNextEpisode,
}: {
  artPlayerRef: MutableRefObject<Artplayer | null>;
  videoTitle: string;
  episodeLabel: string | null;
  videoCover: string;
  hasPreviousEpisode: boolean;
  hasNextEpisode: boolean;
  onPreviousEpisode: () => void;
  onNextEpisode: () => void;
}) {
  const episodeHandlersRef = useRef({ onPreviousEpisode, onNextEpisode });
  episodeHandlersRef.current = { onPreviousEpisode, onNextEpisode };
  // SiteProvider 拿到运行时配置后会直接改写 document.title，依赖整个对象才能在其后重新设置
  const site = useSite();
  const { siteName } = site;

  useEffect(() => {
    document.title = buildPlayDocumentTitle({
      siteName,
      videoTitle,
      episodeLabel,
    });
  }, [site, siteName, videoTitle, episodeLabel]);

  useEffect(() => {
    return () => {
      document.title = siteName;
    };
  }, [siteName]);

  useEffect(() => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) {
      return;
    }
    if (!videoTitle.trim() || typeof MediaMetadata === 'undefined') {
      navigator.mediaSession.metadata = null;
      return;
    }
    const artworkUrl = videoCover
      ? new URL(processImageUrl(videoCover), window.location.href).href
      : '';
    navigator.mediaSession.metadata = new MediaMetadata({
      title: episodeLabel ? `${videoTitle} ${episodeLabel}` : videoTitle,
      artist: siteName,
      artwork: artworkUrl ? [{ src: artworkUrl }] : [],
    });
  }, [siteName, videoTitle, episodeLabel, videoCover]);

  useEffect(() => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) {
      return;
    }
    const getPlayer = () => artPlayerRef.current;
    const seekBy = (offset: number) => {
      const player = getPlayer();
      if (!player) return;
      const duration = Number.isFinite(player.duration) ? player.duration : 0;
      const target = Math.max(0, player.currentTime + offset);
      player.seek = duration > 0 ? Math.min(target, duration) : target;
    };

    setActionHandler('play', () => {
      void getPlayer()?.play();
    });
    setActionHandler('pause', () => getPlayer()?.pause());
    setActionHandler('seekbackward', (details) =>
      seekBy(-(details.seekOffset || SEEK_STEP_SECONDS)),
    );
    setActionHandler('seekforward', (details) =>
      seekBy(details.seekOffset || SEEK_STEP_SECONDS),
    );
    setActionHandler('seekto', (details) => {
      const player = getPlayer();
      if (!player || typeof details.seekTime !== 'number') return;
      player.seek = details.seekTime;
    });

    const syncState = (event: Event) => {
      const player = getPlayer();
      if (!player || event.target !== player.video) return;
      const video = player.video as HTMLVideoElement;
      navigator.mediaSession.playbackState = video.paused
        ? 'paused'
        : 'playing';
      if (
        typeof navigator.mediaSession.setPositionState !== 'function' ||
        !Number.isFinite(video.duration) ||
        video.duration <= 0
      ) {
        return;
      }
      try {
        navigator.mediaSession.setPositionState({
          duration: video.duration,
          playbackRate: video.playbackRate || 1,
          position: Math.min(Math.max(video.currentTime, 0), video.duration),
        });
      } catch {
        // 时长与位置短暂不一致时浏览器会抛错，下一次事件再同步
      }
    };
    for (const eventName of MEDIA_SESSION_SYNC_EVENTS) {
      document.addEventListener(eventName, syncState, true);
    }

    return () => {
      for (const eventName of MEDIA_SESSION_SYNC_EVENTS) {
        document.removeEventListener(eventName, syncState, true);
      }
      for (const action of [
        'play',
        'pause',
        'seekbackward',
        'seekforward',
        'seekto',
      ] as const) {
        setActionHandler(action, null);
      }
      navigator.mediaSession.metadata = null;
      navigator.mediaSession.playbackState = 'none';
    };
  }, [artPlayerRef]);

  useEffect(() => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) {
      return;
    }
    setActionHandler(
      'previoustrack',
      hasPreviousEpisode
        ? () => episodeHandlersRef.current.onPreviousEpisode()
        : null,
    );
    setActionHandler(
      'nexttrack',
      hasNextEpisode ? () => episodeHandlersRef.current.onNextEpisode() : null,
    );
    return () => {
      setActionHandler('previoustrack', null);
      setActionHandler('nexttrack', null);
    };
  }, [hasPreviousEpisode, hasNextEpisode]);
}
