'use client';

import { useCallback, useEffect, useRef } from 'react';

import {
  recordSourcePlaybackFailure,
  recordSourcePlaybackSuccess,
} from '@/lib/source-playback-stats';

type PlaybackLoad = {
  target: string;
  videoUrl: string;
  sourceKey: string;
  startedAt: number;
  settled: boolean;
};

// 源、视频、集数或播放地址变化才算新的一次加载；同一加载内的播放器重建、重试和代理回退沿用起点，成功或失败只记一次
// 逐集解析型源先以空地址进入本集，解析出地址仍是同一次加载，起播耗时要算上解析
export function useSourcePlaybackStatsRecorder({
  sourceKey,
  videoId,
  episodeIndex,
  videoUrl,
}: {
  sourceKey: string;
  videoId: string;
  episodeIndex: number;
  videoUrl: string;
}) {
  const loadRef = useRef<PlaybackLoad | null>(null);

  useEffect(() => {
    const target = JSON.stringify([sourceKey, videoId, episodeIndex]);
    const load = loadRef.current;
    if (load?.target === target) {
      if (load.videoUrl === videoUrl) return;
      if (!load.videoUrl) {
        load.videoUrl = videoUrl;
        return;
      }
    }
    loadRef.current = {
      target,
      videoUrl,
      sourceKey,
      startedAt: performance.now(),
      settled: false,
    };
  }, [sourceKey, videoId, episodeIndex, videoUrl]);

  const settleLoad = useCallback((): PlaybackLoad | null => {
    const load = loadRef.current;
    if (!load || load.settled || !load.sourceKey) return null;
    load.settled = true;
    return load;
  }, []);

  const recordPlaybackStarted = useCallback(() => {
    const load = settleLoad();
    if (!load) return;
    recordSourcePlaybackSuccess(
      load.sourceKey,
      performance.now() - load.startedAt,
    );
  }, [settleLoad]);

  const recordPlaybackFailed = useCallback(() => {
    const load = settleLoad();
    if (!load) return;
    recordSourcePlaybackFailure(load.sourceKey);
  }, [settleLoad]);

  return { recordPlaybackStarted, recordPlaybackFailed };
}
